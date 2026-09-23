/**
 * SSH 隧道模式数据库后端
 * 
 * 统一后端接口：init / query / execute / begin / commit / rollback
 * 每次查询通过 forwardOut 建立临时 MySQL 连接；SSH 断线后指数退避自动重连
 * 事务不支持（需要持久化 SSH 流，暂未实现）
 */
import mysql from 'mysql2';
import { Client } from 'ssh2';
import { execOnConnection } from './exec-on-connection.js';

export function createSSHBackend(sshConfig, dbConfig) {
  let sshClient = null;
  let sshReady = false;
  let reconnectAttempts = 0;
  let reconnectTimer = null;
  const MAX_RECONNECT_DELAY = 30000; // 最大重连间隔 30 秒

  function connectOpts() {
    const opts = {
      host: sshConfig.host,
      port: sshConfig.port,
      username: sshConfig.username,
      readyTimeout: 10000
    };

    if (sshConfig.privateKey) {
      opts.privateKey = sshConfig.privateKey;
      if (sshConfig.passphrase) {
        opts.passphrase = sshConfig.passphrase;
      }
    } else if (sshConfig.password) {
      opts.password = sshConfig.password;
    }

    return opts;
  }

  // 指数退避重连延迟
  function reconnectDelay() {
    return Math.min(1000 * Math.pow(2, reconnectAttempts), MAX_RECONNECT_DELAY);
  }

  // 统一的连接事件绑定（init 与重连共用）
  function attachHandlers(ssh, onReady) {
    ssh.on('ready', () => {
      console.error('[SSH] Connected successfully');
      sshReady = true;
      reconnectAttempts = 0;
      if (onReady) onReady();
    });

    ssh.on('error', (err) => {
      console.error('[SSH] Connection error:', err.message);
      sshReady = false;
      // 断线后自动重连（指数退避）
      scheduleReconnect();
    });

    ssh.on('close', () => {
      console.error('[SSH] Connection closed');
      sshReady = false;
      scheduleReconnect();
    });
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    const delay = reconnectDelay();
    console.error(`[SSH] Reconnecting in ${delay}ms (attempt ${reconnectAttempts + 1})...`);

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      reconnectAttempts++;

      const ssh = new Client();
      sshClient = ssh;
      attachHandlers(ssh, null);
      ssh.connect(connectOpts());
    }, delay);
  }

  function init() {
    return new Promise((resolve, reject) => {
      console.error(`[SSH] Connecting to ${sshConfig.host}:${sshConfig.port}...`);

      const ssh = new Client();
      sshClient = ssh;
      attachHandlers(ssh, () => resolve(true));

      // 首次连接失败直接拒绝启动
      ssh.on('error', (err) => reject(err));

      ssh.connect(connectOpts());
    });
  }

  // 每次查询通过 forwardOut 建立临时 MySQL 连接
  async function run(sql, isExecute) {
    if (!sshClient || !sshReady) {
      throw new Error('SSH 连接未就绪，正在自动重连中，请稍后重试');
    }

    return new Promise((resolve, reject) => {
      sshClient.forwardOut(
        '127.0.0.1',
        0,
        sshConfig.remoteHost,
        sshConfig.remotePort,
        (err, stream) => {
          if (err) {
            console.error('[SSH] forwardOut error:', err.message);
            return reject(new Error(`SSH 隧道错误: ${err.message}`));
          }

          const conn = mysql.createConnection({
            user: dbConfig.user,
            password: dbConfig.password,
            database: dbConfig.database,
            stream: stream
          });

          conn.on('error', (e) => {
            console.error('[MySQL] Connection error:', e.message);
            reject(e);
          });

          execOnConnection(conn, sql, isExecute)
            .then((result) => {
              conn.end();
              resolve(result);
            })
            .catch((e) => {
              conn.end();
              reject(e);
            });
        }
      );
    });
  }

  function query(sql) {
    return run(sql, false);
  }

  function execute(sql) {
    return run(sql, true);
  }

  function begin() {
    return Promise.reject(new Error('SSH 模式暂不支持事务'));
  }

  function commit() {
    return Promise.reject(new Error('当前没有活跃的事务'));
  }

  function rollback() {
    return Promise.reject(new Error('当前没有活跃的事务'));
  }

  return { init, query, execute, begin, commit, rollback };
}
