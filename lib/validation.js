/**
 * 查询验证与结果处理模块
 * 
 * 职责：
 * - 语句白名单校验（mysql_query 准入）
 * - MAX_ROWS 解析与容错
 * - 结果截断
 */

/**
 * 校验 SQL 语句是否符合 mysql_query 白名单
 * 
 * 白名单：SELECT, WITH（主句为 SELECT）, SHOW, DESCRIBE/DESC, EXPLAIN
 * 
 * @param {string} sql - 待校验的 SQL 语句
 * @returns {{ allowed: boolean, reason?: string }}
 */
export function validateQuery(sql) {
  // 去除注释
  const stripped = sql
    .replace(/--.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .trim();

  if (!stripped) {
    return { allowed: false, reason: '空语句' };
  }

  const upper = stripped.toUpperCase();
  const firstKeyword = upper.match(/^(\w+)/)?.[1];

  if (!firstKeyword) {
    return { allowed: false, reason: '无法解析语句' };
  }

  const allowedFirst = ['SELECT', 'SHOW', 'DESCRIBE', 'DESC', 'EXPLAIN', 'WITH'];
  if (!allowedFirst.includes(firstKeyword)) {
    return {
      allowed: false,
      reason: `不允许执行 ${firstKeyword} 语句。如需变更数据请使用 mysql_execute 工具`
    };
  }

  if (firstKeyword === 'WITH') {
    return validateWithClause(stripped);
  }

  return { allowed: true };
}

/**
 * 校验 WITH 语句的主句是否为 SELECT
 * 
 * WITH 语句格式：WITH cte AS (subquery) [, cte2 AS (subquery2)] SELECT ...
 * 主句必须是 SELECT，不允许 INSERT/UPDATE/DELETE
 */
function validateWithClause(sql) {
  let depth = 0;
  let inString = false;
  let stringChar = '';

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];

    if (inString) {
      if (ch === stringChar) {
        // SQL 标准双引号转义: '' 或 ""
        if (sql[i + 1] === stringChar) {
          i++; // 跳过转义的引号对
          continue;
        }
        // 反斜杠转义
        if (sql[i - 1] === '\\') {
          continue;
        }
        inString = false;
      }
      continue;
    }

    if (ch === "'" || ch === '"' || ch === '`') {
      inString = true;
      stringChar = ch;
      continue;
    }

    if (ch === '(') {
      depth++;
    } else if (ch === ')') {
      depth--;

      if (depth === 0) {
        // 找到 CTE 定义结束，检查后续关键词
        const rest = sql.substring(i + 1).trimStart();
        
        // 检查是否有更多 CTE
        if (rest.startsWith(',')) {
          continue;
        }
        
        const nextWord = rest.match(/^(\w+)/)?.[1]?.toUpperCase();

        if (nextWord === 'SELECT') {
          return { allowed: true };
        } else {
          return {
            allowed: false,
            reason: `WITH 语句主句必须是 SELECT，检测到 ${nextWord || '未知关键词'}`
          };
        }
      }
    }
  }

  return { allowed: false, reason: 'WITH 语句格式异常，无法找到主句' };
}

/**
 * 解析 MAX_ROWS 配置值
 * 
 * @param {*} value - 配置值（字符串或数字）
 * @param {number} defaultValue - 默认值，默认 1000
 * @returns {number}
 */
export function parseMaxRows(value, defaultValue = 1000) {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }
  const parsed = parseInt(value, 10);
  if (isNaN(parsed) || parsed <= 0) {
    console.error(`[WARN] MAX_ROWS 值无效 (${value})，使用默认值 ${defaultValue}`);
    return defaultValue;
  }
  return parsed;
}

/**
 * 截断查询结果
 * 
 * @param {Array} rows - 查询结果行
 * @param {number} maxRows - 最大行数
 * @returns {{ rows: Array, truncated: boolean, returnedRows: number, maxRows: number }}
 */
export function truncateResult(rows, maxRows) {
  if (rows.length > maxRows) {
    return {
      rows: rows.slice(0, maxRows),
      truncated: true,
      returnedRows: maxRows,
      maxRows
    };
  }
  return {
    rows,
    truncated: false,
    returnedRows: rows.length,
    maxRows
  };
}
