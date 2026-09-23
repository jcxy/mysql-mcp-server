/**
 * 在 mysql2 连接上执行 SQL 的共享辅助函数
 * 
 * 被 PoolBackend 和 SSHBackend 复用
 * 
 * @param {object} conn - mysql2 连接（回调风格）
 * @param {string} sql - SQL 语句
 * @param {boolean} isExecute - true 用 execute（预编译），false 用 query
 * @returns {Promise<Array|{affectedRows, insertId}>}
 */
export function execOnConnection(conn, sql, isExecute) {
  return new Promise((resolve, reject) => {
    if (isExecute) {
      conn.execute(sql, (err, result) => {
        if (err) {
          reject(err);
        } else {
          resolve({ affectedRows: result.affectedRows, insertId: result.insertId });
        }
      });
    } else {
      conn.query(sql, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    }
  });
}
