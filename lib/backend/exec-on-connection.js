/**
 * 在 mysql2 连接上执行 SQL 的共享辅助函数
 *
 * - execOnConnection   一次性执行（execute 预编译 / 全量 query）
 * - execQueryLimited   流式执行查询：累积到 maxRows 行后再来一行即判定截断，销毁连接中断传输
 *
 * 被 PoolBackend 和 SSHBackend 复用
 */

/**
 * 在连接上执行 SQL
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

/**
 * 流式执行查询并在第 maxRows+1 行处中断
 *
 * 不传回调时 mysql2 不会在内部累积结果集，逐行抛出 'result' 事件，因此内存占用以 maxRows 为界。
 * 判定截断后立即销毁连接：结果集未读完的连接不可复用，调用方在 truncated 为 true 时
 * 不得再 release/end 该连接。
 *
 * @param {object} conn - mysql2 连接（回调风格）
 * @param {string} sql - 查询语句
 * @param {number} maxRows - 最大返回行数
 * @returns {Promise<{rows: Array, truncated: boolean}>}
 */
export function execQueryLimited(conn, sql, maxRows) {
  return new Promise((resolve, reject) => {
    const query = conn.query(sql);
    const rows = [];
    let settled = false;

    function finish(truncated) {
      if (settled) return;
      settled = true;
      if (truncated) {
        conn.destroy();
      }
      resolve({ rows, truncated });
    }

    query.on('result', (row) => {
      if (settled) return;
      if (rows.length < maxRows) {
        rows.push(row);
        return;
      }
      finish(true);
    });

    query.on('error', (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });

    query.on('end', () => finish(false));
  });
}
