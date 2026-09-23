/**
 * 直连模式数据库后端（连接池）
 * 
 * 统一后端接口：init / query / execute / begin / commit / rollback
 * 事务状态（TransactionContext）私有于本模块内部，不变式单点维护：
 *   - txConn !== null ⟺ 活跃事务存在
 *   - 事务连接异常断开时销毁而非归还池（防止污染池）
 *   - commit 失败时销毁连接（MySQL 服务端会在断连时回滚未决事务）
 */
import mysql from 'mysql2';
import { execOnConnection } from './exec-on-connection.js';

export function createPoolBackend(dbConfig, poolOptions = {}) {
  let pool = null;
  let txConn = null; // 事务期间独占的连接；null 表示无活跃事务

  function init() {
    pool = mysql.createPool({
      host: dbConfig.host,
      port: dbConfig.port,
      user: dbConfig.user,
      password: dbConfig.password,
      database: dbConfig.database,
      waitForConnections: true,
      connectionLimit: poolOptions.connectionLimit || 10,
      queueLimit: 0
    });
  }

  // 从池获取连接执行并归还；事务活跃时改用事务连接（不归还）
  async function run(sql, isExecute) {
    if (txConn) {
      return execOnConnection(txConn, sql, isExecute);
    }
    return new Promise((resolve, reject) => {
      pool.getConnection((err, conn) => {
        if (err) {
          return reject(err);
        }
        execOnConnection(conn, sql, isExecute)
          .then((result) => {
            conn.release();
            resolve(result);
          })
          .catch((e) => {
            conn.release();
            reject(e);
          });
      });
    });
  }

  function query(sql) {
    return run(sql, false);
  }

  function execute(sql) {
    return run(sql, true);
  }

  function begin() {
    return new Promise((resolve, reject) => {
      if (txConn) {
        return reject(new Error('已在事务中，请先提交或回滚当前事务'));
      }
      pool.getConnection((err, conn) => {
        if (err) {
          return reject(err);
        }
        conn.beginTransaction((err) => {
          if (err) {
            conn.release();
            return reject(err);
          }
          // 连接异常断开时清理事务状态，防止进程崩溃
          conn.on('error', (e) => {
            console.error('[Transaction] Connection error:', e.message);
            if (txConn === conn) {
              txConn = null;
              // 已损坏的连接不得归还连接池
              conn.destroy();
            }
          });
          txConn = conn;
          resolve(true);
        });
      });
    });
  }

  // 提交/回滚的统一收尾路径：状态清理单点维护
  function finishTransaction(mode) {
    return new Promise((resolve, reject) => {
      const conn = txConn;
      if (!conn) {
        return reject(new Error('当前没有活跃的事务'));
      }
      conn[mode]((err) => {
        if (txConn !== conn) {
          // error 事件处理器已先行清理状态
          return reject(err || new Error('事务连接已断开'));
        }
        txConn = null;
        if (err) {
          // 提交/回滚失败：连接状态不可信，销毁而非归还池；
          // MySQL 服务端会在连接断开时自动回滚未决事务
          conn.destroy();
          reject(err);
        } else {
          conn.release();
          resolve(true);
        }
      });
    });
  }

  function commit() {
    return finishTransaction('commit');
  }

  function rollback() {
    return finishTransaction('rollback');
  }

  return { init, query, execute, begin, commit, rollback };
}
