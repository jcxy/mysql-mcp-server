/**
 * MCP 工具定义与分派模块
 * 
 * handleToolCall 是所有工具调用的咽喉点：
 *   - 白名单校验、只读门控、结果截断统一在此强制（结构保证而非调用点约定）
 *   - 依赖通过 deps 注入 { db, readOnly, maxRows }，测试时用普通对象 fake 即可
 */
import { validateQuery, truncateResult } from './validation.js';

export const toolDefinitions = [
  {
    name: 'mysql_query',
    description: '执行 MySQL 查询，返回查询结果',
    inputSchema: {
      type: 'object',
      properties: {
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
    description: '执行 MySQL 更新/删除/插入语句，返回受影响行数',
    inputSchema: {
      type: 'object',
      properties: {
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
    description: '列出当前数据库中的所有表',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'mysql_describe_table',
    description: '查看指定表的结构（列名、类型、是否可空等）',
    inputSchema: {
      type: 'object',
      properties: {
        table: {
          type: 'string',
          description: '要查看结构的表名',
        },
      },
      required: ['table'],
    },
  },
  {
    name: 'mysql_begin',
    description: '开始一个事务（仅直连模式支持）',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'mysql_commit',
    description: '提交当前事务',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'mysql_rollback',
    description: '回滚当前事务',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

function ok(data) {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
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
 * 工具调用处理器（可导出，便于测试）
 * 
 * @param {string} name - 工具名
 * @param {object} args - 工具参数
 * @param {object} deps - 注入的依赖 { db, readOnly, maxRows }
 * @returns {Promise<{content: Array, isError?: boolean}>}
 */
export async function handleToolCall(name, args, deps) {
  const { db, readOnly, maxRows } = deps;

  try {
    switch (name) {
      case 'mysql_query': {
        // 语句白名单校验
        const validation = validateQuery(args.sql);
        if (!validation.allowed) {
          return err(validation.reason);
        }
        return ok(await readRows(db, args.sql, maxRows));
      }

      case 'mysql_execute': {
        // 只读模式检查
        if (readOnly) {
          return err('当前为只读模式（READ_ONLY=true），变更语句已被禁用。如需执行变更，请关闭只读模式后重试。');
        }
        return ok(await db.execute(args.sql));
      }

      case 'mysql_list_tables': {
        const res = await readRows(db, 'SHOW TABLES', maxRows);
        const tables = res.rows.map((row) => Object.values(row)[0]);
        return ok({
          tables,
          count: tables.length,
          truncated: res.truncated,
          maxRows: res.maxRows,
        });
      }

      case 'mysql_describe_table': {
        const tableName = args.table;
        if (!tableName || typeof tableName !== 'string') {
          return err('表名不能为空');
        }
        // 表名白名单：仅允许字母、数字、下划线（合法 MySQL 标识符）
        if (!/^[a-zA-Z0-9_]+$/.test(tableName)) {
          return err('表名包含非法字符（仅允许字母、数字和下划线）');
        }
        const res = await readRows(db, `DESCRIBE \`${tableName}\``, maxRows);
        return ok({
          table: tableName,
          columns: res.rows,
          truncated: res.truncated,
          maxRows: res.maxRows,
        });
      }

      case 'mysql_begin': {
        if (readOnly) {
          return err('只读模式下不能开启事务');
        }
        await db.begin();
        return ok({ status: '事务已开始' });
      }

      case 'mysql_commit': {
        await db.commit();
        return ok({ status: '事务已提交' });
      }

      case 'mysql_rollback': {
        await db.rollback();
        return ok({ status: '事务已回滚' });
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return err(`Error: ${error.message}`);
  }
}
