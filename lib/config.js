/**
 * 配置解析模块
 * 
 * 职责：从环境变量与配置文件解析出运行期配置
 * 优先级：环境变量 > config.js > 默认值
 */
import { parseMaxRows } from './validation.js';

/**
 * 解析配置（纯函数，便于测试）
 * 
 * @param {object} env - 环境变量对象（通常为 process.env）
 * @param {object} fileConfig - config.js 导出的配置对象
 * @returns {{ ssh: object, db: object, readOnly: boolean, maxRows: number }}
 */
export function loadConfig(env, fileConfig = {}) {
  const ssh = {
    enabled: env.SSH_ENABLED === 'true' || fileConfig.ssh?.enabled || false,
    host: env.SSH_HOST || fileConfig.ssh?.host || '',
    port: parseInt(env.SSH_PORT, 10) || fileConfig.ssh?.port || 22,
    username: env.SSH_USERNAME || fileConfig.ssh?.username || '',
    password: env.SSH_PASSWORD || fileConfig.ssh?.password || '',
    privateKey: env.SSH_PRIVATE_KEY || fileConfig.ssh?.privateKey || '',
    passphrase: env.SSH_PASSPHRASE || fileConfig.ssh?.passphrase || '',
    // 注意：SSH 隧道目标地址回退到 MySQL 环境变量（历史约定的跨块回退，需显式保留）
    remoteHost: env.SSH_REMOTE_HOST || env.MYSQL_HOST || fileConfig.ssh?.remoteHost || 'localhost',
    remotePort: parseInt(env.SSH_REMOTE_PORT, 10) || parseInt(env.MYSQL_PORT, 10) || fileConfig.ssh?.remotePort || 3306
  };

  const db = {
    host: env.MYSQL_HOST || fileConfig.host || 'localhost',
    port: parseInt(env.MYSQL_PORT, 10) || fileConfig.port || 3306,
    user: env.MYSQL_USER || fileConfig.user || 'root',
    password: env.MYSQL_PASSWORD || fileConfig.password || '',
    database: env.MYSQL_DATABASE || fileConfig.database,
  };

  const readOnly = env.READ_ONLY === 'true' || fileConfig.readOnly === true || false;
  const maxRows = parseMaxRows(env.MAX_ROWS || fileConfig.maxRows, 1000);

  return { ssh, db, readOnly, maxRows };
}
