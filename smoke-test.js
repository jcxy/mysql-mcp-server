// 冒烟测试：用 fake 后端驱动 handleToolCall，验证咽喉点逻辑（白名单、只读、截断、错误映射）
// 运行：npm test
import { handleToolCall } from './lib/tools.js';
import { loadConfig } from './lib/config.js';

let passed = 0;
let failed = 0;

function assert(desc, cond) {
  if (cond) {
    passed++;
    console.log(`✓ ${desc}`);
  } else {
    failed++;
    console.log(`✗ ${desc}`);
  }
}

// fake 后端：记录调用
function fakeDb({ rows = [], executeResult = { affectedRows: 1, insertId: 2 } } = {}) {
  const calls = [];
  return {
    calls,
    query: async (sql) => { calls.push(['query', sql]); return rows; },
    execute: async (sql) => { calls.push(['execute', sql]); return executeResult; },
    begin: async () => { calls.push(['begin']); },
    commit: async () => { calls.push(['commit']); },
    rollback: async () => { calls.push(['rollback']); },
  };
}

const deps = { db: fakeDb({ rows: [{ id: 1 }, { id: 2 }] }), readOnly: false, maxRows: 1000 };

// 1. mysql_query 正常路径
let r = await handleToolCall('mysql_query', { sql: 'SELECT * FROM t' }, deps);
assert('mysql_query 正常返回包装结构', !r.isError && JSON.parse(r.content[0].text).rows.length === 2);

// 2. 白名单拒绝
r = await handleToolCall('mysql_query', { sql: 'DROP TABLE x' }, deps);
assert('mysql_query 拒绝 DROP', r.isError && r.content[0].text.includes('不允许执行 DROP'));

// 3. 只读拒绝
r = await handleToolCall('mysql_execute', { sql: 'UPDATE t SET a=1' }, { ...deps, readOnly: true });
assert('只读模式拒绝 execute', r.isError && r.content[0].text.includes('只读模式'));

// 4. 只读放行
r = await handleToolCall('mysql_execute', { sql: 'UPDATE t SET a=1' }, deps);
assert('非只读 execute 正常', !r.isError && JSON.parse(r.content[0].text).affectedRows === 1);

// 5. list_tables 截断通道
r = await handleToolCall('mysql_list_tables', {}, deps);
assert('list_tables 走截断通道', !r.isError && JSON.parse(r.content[0].text).count === 2);

// 6. describe_table 表名校验
r = await handleToolCall('mysql_describe_table', { table: 'users; DROP TABLE x' }, deps);
assert('describe_table 拒绝非法表名', r.isError);

r = await handleToolCall('mysql_describe_table', { table: 'users' }, deps);
assert('describe_table 合法表名', !r.isError);

// 7. 截断生效
const manyRows = Array.from({ length: 20 }, (_, i) => ({ i }));
r = await handleToolCall('mysql_query', { sql: 'SELECT 1' }, { db: fakeDb({ rows: manyRows }), readOnly: false, maxRows: 10 });
const parsed = JSON.parse(r.content[0].text);
assert('结果截断生效', parsed.truncated === true && parsed.returnedRows === 10);

// 8. 事务工具
r = await handleToolCall('mysql_begin', {}, deps);
assert('begin 正常', !r.isError);
r = await handleToolCall('mysql_commit', {}, deps);
assert('commit 正常', !r.isError);
r = await handleToolCall('mysql_rollback', {}, { db: { rollback: async () => { throw new Error('无事务'); } }, readOnly: false, maxRows: 1000 });
assert('rollback 错误映射为 isError', r.isError && r.content[0].text.includes('Error:'));

// 9. 只读模式拒绝 begin
r = await handleToolCall('mysql_begin', {}, { ...deps, readOnly: true });
assert('只读模式拒绝 begin', r.isError);

// 10. 未知工具
r = await handleToolCall('nope', {}, deps);
assert('未知工具报错', r.isError && r.content[0].text.includes('Unknown tool'));

// 11. loadConfig 纯函数：env 优先 + 跨块回退
const cfg = loadConfig({ MYSQL_HOST: 'env-host', SSH_ENABLED: 'true' }, { host: 'file-host', readOnly: true, maxRows: 'abc' });
assert('loadConfig env 优先', cfg.db.host === 'env-host');
assert('loadConfig SSH 开关', cfg.ssh.enabled === true);
assert('loadConfig 只读来自 config.js', cfg.readOnly === true);
assert('loadConfig 非法 maxRows 回退 1000', cfg.maxRows === 1000);
assert('loadConfig SSH remoteHost 跨块回退到 MYSQL_HOST', cfg.ssh.remoteHost === 'env-host');

console.log(`\n冒烟测试: ${passed} 通过, ${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);
