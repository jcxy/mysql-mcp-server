/**
 * 配置解析模块
 *
 * 职责：从环境变量、配置文件与凭据对象解析出运行期配置（环境注册表形状）
 *
 * 双格式兼容：
 *   - 新格式（配置含 environments 键）：环境结构与 readOnly 策略来自配置文件（可提交可共享），
 *     秘密（密码/SSH 私钥）仅来自凭据对象；MYSQL_* 与 SSH_* 环境变量不作用于环境定义
 *   - 旧格式（单连接，无 environments 键）：映射为名为 default 的单一环境，
 *     优先级保持 环境变量 > 凭据对象(default 条目) > config.js > 默认值，行为零变化
 *
 * 启动期结构校验在解析内完成（纯函数，不建连接、不做 I/O）；
 * 凭据文件的真实读取留在装配层薄层，解析只接收已读出的凭据对象
 */
import { parseMaxRows } from './validation.js';

// 环境名白名单：与表名一致，仅字母、数字、下划线（同时保证 environment 参数路由安全）
const ENV_NAME_RE = /^[a-zA-Z0-9_]+$/;

/**
 * 解析配置（纯函数，便于测试）
 *
 * @param {object} env - 环境变量对象（通常为 process.env）
 * @param {object} fileConfig - config.js 导出的配置对象
 * @param {object} credentials - 凭据对象（环境名 → { password, ssh: { password, privateKey, passphrase } }）
 * @returns {{ environments: object, defaultEnvironment: string, errors: string[] }}
 *          errors 非空时 environments 为空对象，调用方应拒绝启动
 */
export function loadConfig(env, fileConfig = {}, credentials = {}) {
  if (fileConfig?.environments !== undefined) {
    return parseMultiEnv(fileConfig, credentials);
  }
  return parseLegacy(env, fileConfig, credentials);
}

/**
 * 旧格式（单连接）解析：映射为 default 单环境，行为与历史版本零变化
 */
function parseLegacy(env, fileConfig, credentials) {
  const cred = credentials.default || {};

  const ssh = {
    enabled: env.SSH_ENABLED === 'true' || fileConfig.ssh?.enabled || false,
    host: env.SSH_HOST || fileConfig.ssh?.host || '',
    port: parseInt(env.SSH_PORT, 10) || fileConfig.ssh?.port || 22,
    username: env.SSH_USERNAME || fileConfig.ssh?.username || '',
    password: env.SSH_PASSWORD || cred.ssh?.password || fileConfig.ssh?.password || '',
    privateKey: env.SSH_PRIVATE_KEY || cred.ssh?.privateKey || fileConfig.ssh?.privateKey || '',
    passphrase: env.SSH_PASSPHRASE || cred.ssh?.passphrase || fileConfig.ssh?.passphrase || '',
    // 注意：SSH 隧道目标地址回退到 MySQL 环境变量（历史约定的跨块回退，需显式保留）
    remoteHost: env.SSH_REMOTE_HOST || env.MYSQL_HOST || fileConfig.ssh?.remoteHost || 'localhost',
    remotePort: parseInt(env.SSH_REMOTE_PORT, 10) || parseInt(env.MYSQL_PORT, 10) || fileConfig.ssh?.remotePort || 3306
  };

  const db = {
    host: env.MYSQL_HOST || fileConfig.host || 'localhost',
    port: parseInt(env.MYSQL_PORT, 10) || fileConfig.port || 3306,
    user: env.MYSQL_USER || fileConfig.user || 'root',
    password: env.MYSQL_PASSWORD || cred.password || fileConfig.password || '',
    database: env.MYSQL_DATABASE || fileConfig.database,
  };

  const readOnly = env.READ_ONLY === 'true' || fileConfig.readOnly === true || false;
  const maxRows = parseMaxRows(env.MAX_ROWS || fileConfig.maxRows, 1000);

  return {
    environments: { default: { ssh, db, readOnly, maxRows } },
    defaultEnvironment: 'default',
    errors: [],
  };
}

/**
 * 新格式（多环境）解析：环境结构来自配置文件，秘密仅来自凭据对象
 */
function parseMultiEnv(fileConfig, credentials) {
  const errors = [];
  const environments = {};
  const envDefs = fileConfig.environments;

  if (!envDefs || typeof envDefs !== 'object' || Array.isArray(envDefs)) {
    return {
      environments: {},
      defaultEnvironment: 'default',
      errors: ['environments 必须是非空对象（环境名 → 环境定义）'],
    };
  }

  for (const [name, def] of Object.entries(envDefs)) {
    if (!ENV_NAME_RE.test(name)) {
      errors.push(`非法环境名 "${name}"（仅允许字母、数字和下划线）`);
      continue;
    }
    if (!def || typeof def !== 'object') {
      errors.push(`环境 "${name}" 的定义必须是非空对象`);
      continue;
    }
    environments[name] = parseEnvEntry(def, credentials[name] || {});
  }

  // 默认环境解析：显式声明 > 单环境自动指向；多环境缺失或指向未注册环境 → 拒启
  let defaultEnvironment = fileConfig.defaultEnvironment;
  const names = Object.keys(environments);
  if (!defaultEnvironment && names.length === 1) {
    defaultEnvironment = names[0];
  }
  if (!defaultEnvironment && names.length > 1) {
    errors.push('多环境配置必须显式声明 defaultEnvironment（默认环境）');
  } else if (defaultEnvironment && !environments[defaultEnvironment]) {
    errors.push(`defaultEnvironment "${defaultEnvironment}" 不是已注册的环境（可用: ${names.join(', ') || '无'}）`);
  }

  return {
    environments,
    defaultEnvironment: defaultEnvironment || 'default',
    errors,
  };
}

/**
 * 解析单个环境定义：结构默认值与旧格式保持一致，秘密仅取自凭据条目
 */
function parseEnvEntry(def, cred) {
  const db = {
    host: def.host || 'localhost',
    port: parseInt(def.port, 10) || 3306,
    user: def.user || 'root',
    password: cred.password ?? '',
    database: def.database,
  };

  const ssh = {
    enabled: def.ssh?.enabled === true,
    host: def.ssh?.host || '',
    port: parseInt(def.ssh?.port, 10) || 22,
    username: def.ssh?.username || '',
    password: cred.ssh?.password ?? '',
    privateKey: cred.ssh?.privateKey ?? '',
    passphrase: cred.ssh?.passphrase ?? '',
    // 隧道目标未声明时回退本环境的数据库地址（与旧格式跨块回退语义一致）
    remoteHost: def.ssh?.remoteHost || db.host,
    remotePort: parseInt(def.ssh?.remotePort, 10) || db.port,
  };

  return {
    ssh,
    db,
    readOnly: def.readOnly === true,
    maxRows: parseMaxRows(def.maxRows, 1000),
  };
}
