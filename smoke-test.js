// 冒烟测试：用 fake 后端驱动 handleToolCall，验证咽喉点逻辑（白名单、只读、截断、错误映射）
// 运行：npm test
import { handleToolCall, buildToolDefinitions } from './lib/tools.js';
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

// ==================== 多环境注册表（T1: 环境路由 / per-env 门禁 / 回显）====================
const devDb = fakeDb({ rows: [{ env: 'dev' }] });
const prodDb = fakeDb({ rows: [{ env: 'prod' }] });
const registryDeps = {
  environments: {
    dev: { db: devDb, readOnly: false, maxRows: 1000 },
    prod: { db: prodDb, readOnly: true, maxRows: 5 },
  },
  defaultEnvironment: 'dev',
};

// 12. 默认环境路由 + environment 回显
r = await handleToolCall('mysql_query', { sql: 'SELECT 1' }, registryDeps);
let p = JSON.parse(r.content[0].text);
assert('未传 environment 落到默认环境 dev', !r.isError && p.environment === 'dev' && devDb.calls.length === 1 && prodDb.calls.length === 0);

// 13. 显式 environment 路由
r = await handleToolCall('mysql_query', { sql: 'SELECT 1', environment: 'prod' }, registryDeps);
p = JSON.parse(r.content[0].text);
assert('environment=prod 路由到 prod 且回显', !r.isError && p.environment === 'prod' && prodDb.calls.length === 1);

// 14. 未知环境报错并列出可用环境
r = await handleToolCall('mysql_query', { sql: 'SELECT 1', environment: 'staging' }, registryDeps);
assert('未知环境报错并列出 dev/prod', r.isError && r.content[0].text.includes('staging') && r.content[0].text.includes('dev') && r.content[0].text.includes('prod'));

// 15. per-env 只读门禁互不影响
r = await handleToolCall('mysql_execute', { sql: 'UPDATE t SET a=1', environment: 'prod' }, registryDeps);
assert('prod 只读拒绝 execute', r.isError && r.content[0].text.includes('只读'));
r = await handleToolCall('mysql_execute', { sql: 'UPDATE t SET a=1', environment: 'dev' }, registryDeps);
assert('dev 非只读放行 execute', !r.isError);
r = await handleToolCall('mysql_begin', { environment: 'prod' }, registryDeps);
assert('prod 只读拒绝 begin', r.isError);

// 16. per-env 截断各白生效
const manyRowsEnv = Array.from({ length: 10 }, (_, i) => ({ i }));
const sharedDb = fakeDb({ rows: manyRowsEnv });
const truncDeps = {
  environments: {
    small: { db: sharedDb, readOnly: false, maxRows: 3 },
    big: { db: sharedDb, readOnly: false, maxRows: 100 },
  },
  defaultEnvironment: 'small',
};
r = await handleToolCall('mysql_query', { sql: 'SELECT 1', environment: 'small' }, truncDeps);
p = JSON.parse(r.content[0].text);
assert('small 环境 maxRows=3 截断', !r.isError && p.truncated === true && p.returnedRows === 3);
r = await handleToolCall('mysql_query', { sql: 'SELECT 1', environment: 'big' }, truncDeps);
p = JSON.parse(r.content[0].text);
assert('big 环境不截断', !r.isError && p.truncated === false && p.returnedRows === 10);

// 17. 事务工具 environment 路由到对应实例
r = await handleToolCall('mysql_begin', { environment: 'dev' }, registryDeps);
assert('begin 路由到 dev 实例', !r.isError && devDb.calls.some((c) => c[0] === 'begin'));
r = await handleToolCall('mysql_commit', { environment: 'dev' }, registryDeps);
assert('commit 路由到 dev 实例', !r.isError && devDb.calls.some((c) => c[0] === 'commit'));
r = await handleToolCall('mysql_rollback', { environment: 'dev' }, registryDeps);
assert('rollback 路由到 dev 实例', !r.isError && devDb.calls.some((c) => c[0] === 'rollback'));

// 18. 工具定义：全部含可选 environment 参数，描述列出环境名与默认环境
const defs = buildToolDefinitions({ environmentNames: ['dev', 'prod'], defaultEnvironment: 'dev' });
assert('7 个工具定义均含 environment 参数', defs.length === 7 && defs.every((d) => d.inputSchema.properties?.environment));
assert('工具描述列出环境名与默认环境', defs[0].description.includes('dev') && defs[0].description.includes('prod') && defs[0].description.includes('默认'));

// 19. 旧单环境 deps 形状仍兼容（映射为 default 环境）
r = await handleToolCall('mysql_query', { sql: 'SELECT 1' }, deps);
p = JSON.parse(r.content[0].text);
assert('旧形状 deps 映射为 default 环境且行为不变', !r.isError && p.environment === 'default' && p.rows.length === 2);

// 20. args 显式传 null：与升级前一致走 isError 路径，而非抛出未捕获 TypeError
r = await handleToolCall('mysql_query', null, deps);
assert('args=null 映射为 isError 而非未捕获异常', r.isError && r.content[0].text.includes('Error:'));

console.log(`\n冒烟测试: ${passed} 通过, ${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);
