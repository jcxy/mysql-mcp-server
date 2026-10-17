/**
 * MCP 工具定义与分派模块
 * 
 * handleToolCall 是所有工具调用的咽喉点：
 *   - 环境路由、白名单校验、per-env 只读门控、per-env 截断、环境回显统一在此强制（结构保证而非调用点约定）
 *   - 依赖通过 deps 注入环境注册表形状
 *     { environments: { <name>: { db, readOnly, maxRows } }, defaultEnvironment }
 *     旧单环境形状 { db, readOnly, maxRows } 自动映射为名为 default 的单一环境（向后兼容）
 */
import { validateQuery, truncateResult } from './validation.js';

/**
 * 构建工具定义（环境感知）
 * 
 * @param {{ environmentNames: string[], defaultEnvironment: string }} [envMeta] - 环境注册表元信息，写入工具描述供 AI 路由
 * @returns {Array} MCP 工具定义列表
 */
export function buildToolDefinitions(envMeta = { environmentNames: ['default'], defaultEnvironment: 'default' }) {
  const envHint = `可用环境: ${envMeta.environmentNames.join(', ')}（默认: ${envMeta.defaultEnvironment}）`;
  const environmentProp = {
    type: 'string',
    description: `目标环境名。${envHint}。未传时使用默认环境`,
  };
  return [
    {
      name: 'mysql_query',
      description: `执行 MySQL 查询，返回查询结果。${envHint}`,
      inputSchema: {
        type: 'object',
        properties: {
          environment: environmentProp,
          sql: {
            type: 'string',
            description: '要执行的 SQL 查询语句',
          },
        },
        required: ['sql'],
      },
    },
    {
      name: 'mysql_execute',
      description: `执行 MySQL 更新/删除/插入语句，返回受影响行数。${envHint}`,
      inputSchema: {
        type: 'object',
        properties: {
          environment: environmentProp,
          sql: {
            type: 'string',
            description: '要执行的 SQL 语句（UPDATE/DELETE/INSERT）',
          },
        },
        required: ['sql'],
      },
    },
    {
      name: 'mysql_list_tables',
      description: `列出数据库中的所有表。可传 database 参数指定库；环境未配置默认库且未传参时返回数据库列表。${envHint}`,
      inputSchema: {
        type: 'object',
        properties: {
          environment: environmentProp,
          database: {
            type: 'string',
            description: '可选。目标数据库名；未传时使用环境配置的默认库，无默认库时返回数据库列表',
          },
        },
      },
    },
    {
      name: 'mysql_describe_table',
      description: `查看指定表的结构（列名、类型、是否可空等）。${envHint}`,
      inputSchema: {
        type: 'object',
        properties: {
          environment: environmentProp,
          table: {
            type: 'string',
            description: '表名，支持 库名.表名 形式（多库实例无默认库时使用）',
          },
        },
        required: ['table'],
      },
    },
    {
      name: 'mysql_begin',
      description: `开始一个事务（仅直连模式支持）。${envHint}`,
      inputSchema: {
        type: 'object',
        properties: {
          environment: environmentProp,
        },
      },
    },
    {
      name: 'mysql_commit',
      description: `提交当前事务。${envHint}`,
      inputSchema: {
        type: 'object',
        properties: {
          environment: environmentProp,
        },
      },
    },
    {
      name: 'mysql_rollback',
      description: `回滚当前事务。${envHint}`,
      inputSchema: {
        type: 'object',
        properties: {
          environment: environmentProp,
        },
      },
    },
  ];
}

// 静态导出：单环境默认元信息；运行期由 index.js 调 buildToolDefinitions 注入真实环境元信息
export const toolDefinitions = buildToolDefinitions();

function ok(data, environment) {
  return {
    content: [{ type: 'text', text: JSON.stringify({ environment, ...data }, null, 2) }],
  };
}

function err(message) {
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
  };
}

/**
 * 读取类查询的统一通道：执行 + 截断（咽喉点）
 */
async function readRows(db, sql, maxRows) {
  const rows = await db.query(sql);
  return truncateResult(rows, maxRows);
}

/**
 * 归一化注入依赖：新形状（环境注册表）原样接受；旧单环境形状映射为 default 单环境
 */
function normalizeDeps(deps) {
  if (deps && deps.environments) {
    const names = Object.keys(deps.environments);
    let defaultEnvironment = deps.defaultEnvironment;
    if (!defaultEnvironment && names.length === 1) {
      defaultEnvironment = names[0];
    }
    // 多环境未声明默认时回退 'default'：必然未注册 → 咽喉点报“未知环境”并列出可用环境，
    // 宁可大声失败也不静默猜测（T2 启动期校验会直接拒启这种配置，此处是最后防线）
    return { environments: deps.environments, defaultEnvironment: defaultEnvironment || 'default' };
  }
  return {
    environments: { default: { db: deps.db, database: deps.database, readOnly: deps.readOnly, maxRows: deps.maxRows } },
    defaultEnvironment: 'default',
  };
}

/**
 * 工具调用处理器（可导出，便于测试）
 * 
 * @param {string} name - 工具名
 * @param {object} args - 工具参数（含可选 environment 环境路由参数）
 * @param {object} deps - 注入的依赖（环境注册表形状或旧单环境形状）
 * @returns {Promise<{content: Array, isError?: boolean}>}
 */
export async function handleToolCall(name, args = {}, deps) {
  const registry = normalizeDeps(deps);
  // 可选链防御：args 显式传 null 时与旧版一致走 isError 路径，而非抛出未捕获 TypeError
  const envName = args?.environment ?? registry.defaultEnvironment;
  const env = registry.environments[envName];

  if (!env) {
    return err(
      `未知环境 "${envName}"。可用环境: ${Object.keys(registry.environments).join(', ')}（默认: ${registry.defaultEnvironment}）`
    );
  }

  const { db, readOnly, maxRows } = env;

  try {
    switch (name) {
      case 'mysql_query': {
        // 语句白名单校验
        const validation = validateQuery(args.sql);
        if (!validation.allowed) {
          return err(validation.reason);
        }
        return ok(await readRows(db, args.sql, maxRows), envName);
      }

      case 'mysql_execute': {
        // 只读模式检查
        if (readOnly) {
          return err(`当前环境 "${envName}" 为只读模式，变更语句已被禁用。如需执行变更，请切换到非只读环境或调整该环境的 readOnly 配置后重试。`);
        }
        return ok(await db.execute(args.sql), envName);
      }

      case 'mysql_list_tables': {
        const targetDb = args.database;
        if (targetDb !== undefined && (typeof targetDb !== 'string' || !/^[a-zA-Z0-9_]+$/.test(targetDb))) {
          return err('database 参数包含非法字符（仅允许字母、数字和下划线）');
        }
        // 优先级：显式 database 参数 > 环境默认库 > 回退列出所有数据库（多库实例无单一默认库）
        if (targetDb) {
          const res = await readRows(db, `SHOW TABLES FROM \`${targetDb}\``, maxRows);
          const tables = res.rows.map((row) => Object.values(row)[0]);
          return ok({
            database: targetDb,
            tables,
            count: tables.length,
            truncated: res.truncated,
            maxRows: res.maxRows,
          }, envName);
        }
        if (env.database) {
          const res = await readRows(db, 'SHOW TABLES', maxRows);
          const tables = res.rows.map((row) => Object.values(row)[0]);
          return ok({
            database: env.database,
            tables,
            count: tables.length,
            truncated: res.truncated,
            maxRows: res.maxRows,
          }, envName);
        }
        const res = await readRows(db, 'SHOW DATABASES', maxRows);
        const databases = res.rows.map((row) => Object.values(row)[0]);
        return ok({
          databases,
          count: databases.length,
          hint: '该环境未配置默认数据库，以上为数据库列表。可通过 database 参数查看指定库的表，或用 库名.表名 调用 mysql_describe_table',
          truncated: res.truncated,
          maxRows: res.maxRows,
        }, envName);
      }

      case 'mysql_describe_table': {
        const tableName = args.table;
        if (!tableName || typeof tableName !== 'string') {
          return err('表名不能为空');
        }
        // 表名白名单：仅允许字母、数字、下划线，支持 库名.表名 限定形式（无默认库的环境需要）
        if (!/^[a-zA-Z0-9_]+(\.[a-zA-Z0-9_]+)?$/.test(tableName)) {
          return err('表名包含非法字符（仅允许字母、数字、下划线，可选 库名.表名 形式）');
        }
        const quoted = tableName.split('.').map((part) => `\`${part}\``).join('.');
        const res = await readRows(db, `DESCRIBE ${quoted}`, maxRows);
        return ok({
          table: tableName,
          columns: res.rows,
          truncated: res.truncated,
          maxRows: res.maxRows,
        }, envName);
      }

      case 'mysql_begin': {
        if (readOnly) {
          return err(`环境 "${envName}" 为只读模式，不能开启事务`);
        }
        await db.begin();
        return ok({ status: '事务已开始' }, envName);
      }

      case 'mysql_commit': {
        await db.commit();
        return ok({ status: '事务已提交' }, envName);
      }

      case 'mysql_rollback': {
        await db.rollback();
        return ok({ status: '事务已回滚' }, envName);
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return err(`Error: ${error.message}`);
  }
}
