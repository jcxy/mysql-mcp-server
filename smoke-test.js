// 冒烟测试：用 fake 后端驱动 handleToolCall，验证咽喉点逻辑（白名单、只读、截断、错误映射）
// 运行：npm test
import { EventEmitter } from 'events';
import { handleToolCall, buildToolDefinitions } from './lib/tools.js';
import { loadConfig } from './lib/config.js';
import { execQueryLimited } from './lib/backend/exec-on-connection.js';

let passed = 0;
let failed = 0;

// 截断时会前置一个提示块，JSON 始终在最后一个 content 块
function payloadOf(r) {
  return JSON.parse(r.content[r.content.length - 1].text);
}

function assert(desc, cond) {
  if (cond) {
    passed++;
    console.log(`✓ ${desc}`);
  } else {
    failed++;
    console.log(`✗ ${desc}`);
  }
}

// fake 后端：记录调用；queryLimited 模拟后端的流式截断结果
function fakeDb({ rows = [], executeResult = { affectedRows: 1, insertId: 2 } } = {}) {
  const calls = [];
  return {
    calls,
    queryLimited: async (sql, maxRows) => {
      calls.push(['queryLimited', sql, maxRows]);
      return { rows: rows.slice(0, maxRows), truncated: rows.length > maxRows };
    },
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
assert('mysql_query 正常返回包装结构', !r.isError && payloadOf(r).rows.length === 2);

// 2. 白名单拒绝
r = await handleToolCall('mysql_query', { sql: 'DROP TABLE x' }, deps);
assert('mysql_query 拒绝 DROP', r.isError && r.content[0].text.includes('不允许执行 DROP'));

// 3. 只读拒绝
r = await handleToolCall('mysql_execute', { sql: 'UPDATE t SET a=1' }, { ...deps, readOnly: true });
assert('只读模式拒绝 execute', r.isError && r.content[0].text.includes('只读模式'));

// 4. 只读放行
r = await handleToolCall('mysql_execute', { sql: 'UPDATE t SET a=1' }, deps);
assert('非只读 execute 正常', !r.isError && payloadOf(r).affectedRows === 1);

// 5. list_tables 截断通道
r = await handleToolCall('mysql_list_tables', {}, deps);
assert('list_tables 走截断通道', !r.isError && payloadOf(r).count === 2);

// 6. describe_table 表名校验
r = await handleToolCall('mysql_describe_table', { table: 'users; DROP TABLE x' }, deps);
assert('describe_table 拒绝非法表名', r.isError);

r = await handleToolCall('mysql_describe_table', { table: 'users' }, deps);
assert('describe_table 合法表名', !r.isError);

// 7. 截断生效
const manyRows = Array.from({ length: 20 }, (_, i) => ({ i }));
r = await handleToolCall('mysql_query', { sql: 'SELECT 1' }, { db: fakeDb({ rows: manyRows }), readOnly: false, maxRows: 10 });
const parsed = payloadOf(r);
assert('结果截断生效', parsed.truncated === true && parsed.returnedRows === 10);
assert('截断时首个 content 块为可见提示', r.content.length === 2 && r.content[0].text.includes('结果已截断') && r.content[0].text.includes('maxRows=10'));
assert('截断字段前置于 JSON（先于 rows）', Object.keys(parsed).slice(0, 4).join(',') === 'environment,truncated,returnedRows,maxRows');

// 7.1 未截断时只有一个 content 块，且结构不变
r = await handleToolCall('mysql_query', { sql: 'SELECT 1' }, { db: fakeDb({ rows: [{ a: 1 }] }), readOnly: false, maxRows: 10 });
assert('未截断不产生提示块', r.content.length === 1 && payloadOf(r).truncated === false);

// 7.2 execQueryLimited：读满 maxRows+1 行即中断并销毁连接（不把全量结果读入内存）
function fakeLimitedConn(rowCount) {
  const query = new EventEmitter();
  const conn = { destroyed: false };
  conn.query = () => {
    setImmediate(() => {
      for (let i = 0; i < rowCount && !conn.destroyed; i++) query.emit('result', { i });
      query.emit('end');
    });
    return query;
  };
  conn.destroy = () => { conn.destroyed = true; };
  return conn;
}
let conn = fakeLimitedConn(100);
let limited = await execQueryLimited(conn, 'SELECT 1', 10);
assert('execQueryLimited 截断时返回 maxRows 行', limited.rows.length === 10 && limited.truncated === true);
assert('execQueryLimited 截断时销毁连接中断传输', conn.destroyed === true);
conn = fakeLimitedConn(5);
limited = await execQueryLimited(conn, 'SELECT 1', 10);
assert('execQueryLimited 未超限时返回全部行且不销毁连接', limited.rows.length === 5 && limited.truncated === false && conn.destroyed === false);
conn = fakeLimitedConn(10);
limited = await execQueryLimited(conn, 'SELECT 1', 10);
assert('execQueryLimited 恰好等于 maxRows 不算截断', limited.rows.length === 10 && limited.truncated === false && conn.destroyed === false);

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

// 11. loadConfig 纯函数：env 优先 + 跨块回退（返回环境注册表形状，旧格式映射 default 单环境）
const cfg = loadConfig({ MYSQL_HOST: 'env-host', SSH_ENABLED: 'true' }, { host: 'file-host', readOnly: true, maxRows: 'abc' });
assert('loadConfig env 优先', cfg.environments.default.db.host === 'env-host');
assert('loadConfig SSH 开关', cfg.environments.default.ssh.enabled === true);
assert('loadConfig 只读来自配置文件', cfg.environments.default.readOnly === true);
assert('loadConfig 非法 maxRows 回退 1000', cfg.environments.default.maxRows === 1000);
assert('loadConfig SSH remoteHost 跨块回退到 MYSQL_HOST', cfg.environments.default.ssh.remoteHost === 'env-host');

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
let p = payloadOf(r);
assert('未传 environment 落到默认环境 dev', !r.isError && p.environment === 'dev' && devDb.calls.length === 1 && prodDb.calls.length === 0);

// 13. 显式 environment 路由
r = await handleToolCall('mysql_query', { sql: 'SELECT 1', environment: 'prod' }, registryDeps);
p = payloadOf(r);
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
p = payloadOf(r);
assert('small 环境 maxRows=3 截断', !r.isError && p.truncated === true && p.returnedRows === 3);
r = await handleToolCall('mysql_query', { sql: 'SELECT 1', environment: 'big' }, truncDeps);
p = payloadOf(r);
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

// 18.1 工具描述向 AI 声明各环境的行数上限（提前知道→主动写 LIMIT）
const limitedDefs = buildToolDefinitions({
  environmentNames: ['dev', 'prod'],
  defaultEnvironment: 'dev',
  maxRowsByEnv: { dev: 1000, prod: 100 },
});
const queryDef = limitedDefs.find((d) => d.name === 'mysql_query');
assert('mysql_query 描述声明 per-env 行数上限', queryDef.description.includes('dev ≤ 1000') && queryDef.description.includes('prod ≤ 100'));
assert('list_tables/describe_table 描述同样声明上限', limitedDefs.filter((d) => ['mysql_list_tables', 'mysql_describe_table'].includes(d.name)).every((d) => d.description.includes('prod ≤ 100')));

// 19. 旧单环境 deps 形状仍兼容（映射为 default 环境）
r = await handleToolCall('mysql_query', { sql: 'SELECT 1' }, deps);
p = payloadOf(r);
assert('旧形状 deps 映射为 default 环境且行为不变', !r.isError && p.environment === 'default' && p.rows.length === 2);

// 20. args 显式传 null：与升级前一致走 isError 路径，而非抛出未捕获 TypeError
r = await handleToolCall('mysql_query', null, deps);
assert('args=null 映射为 isError 而非未捕获异常', r.isError && r.content[0].text.includes('Error:'));

// ==================== 多环境配置解析（T2: environments 解析 / 启动期校验）====================
const multiFile = {
  defaultEnvironment: 'dev',
  environments: {
    dev: { host: 'dev-host', user: 'dev-user', password: 'dev-secret', database: 'devdb', readOnly: false, maxRows: 500 },
    prod: { host: 'prod-host', user: 'ai_readonly', password: 'prod-secret', database: 'proddb', readOnly: true, maxRows: 100 },
  },
};

// 21. 多环境解析 + 秘密来自配置文件
const m = loadConfig({ MYSQL_HOST: 'should-be-ignored' }, multiFile);
assert('多环境解析出两个环境且无错误', !m.errors.length && Object.keys(m.environments).length === 2);
assert('多环境 defaultEnvironment 生效', m.defaultEnvironment === 'dev');
assert('dev 密码来自配置文件', m.environments.dev.db.password === 'dev-secret');
assert('prod 密码来自配置文件且 readOnly=true', m.environments.prod.db.password === 'prod-secret' && m.environments.prod.readOnly === true);
assert('多环境下 MYSQL_* 环境变量不作用于环境定义', m.environments.dev.db.host === 'dev-host');
assert('per-env maxRows 解析', m.environments.dev.maxRows === 500 && m.environments.prod.maxRows === 100);

// 22. 旧格式映射 default 单环境 + 密码优先级 env > config.json
const legacy1 = loadConfig({ MYSQL_HOST: 'env-host' }, { host: 'file-host' });
assert('旧格式映射 default 单环境', !legacy1.errors.length && legacy1.defaultEnvironment === 'default' && legacy1.environments.default.db.host === 'env-host');
const legacy2 = loadConfig({ MYSQL_PASSWORD: 'env-pw' }, { host: 'file-host', password: 'file-pw' });
assert('旧格式密码优先级 env>config.json', legacy2.environments.default.db.password === 'env-pw');
const legacy3 = loadConfig({}, { host: 'file-host', password: 'file-pw' });
assert('无环境变量时回退 config.json 密码', legacy3.environments.default.db.password === 'file-pw');
const legacy4 = loadConfig({}, { host: 'file-host' });
assert('无密码不阻断（空密码）', !legacy4.errors.length && legacy4.environments.default.db.password === '');

// 23. 启动期结构校验
const single = loadConfig({}, { environments: { dev: { host: 'h' } } });
assert('单环境省略默认自动指向唯一环境', !single.errors.length && single.defaultEnvironment === 'dev');
const noDefault = loadConfig({}, { environments: { dev: { host: 'h' }, prod: { host: 'h2' } } });
assert('多环境缺默认环境拒启', noDefault.errors.length > 0);
const badDefault = loadConfig({}, { defaultEnvironment: 'staging', environments: { dev: { host: 'h' } } });
assert('默认环境指向未注册环境拒启', badDefault.errors.length > 0);
const badName = loadConfig({}, { environments: { 'dev-1': { host: 'h' } } });
assert('非法环境名拒启', badName.errors.length > 0);
const okName = loadConfig({}, { environments: { dev_1: { host: 'h' } } });
assert('合法环境名（字母数字下划线）通过', !okName.errors.length && okName.defaultEnvironment === 'dev_1');
const badEnvType = loadConfig({}, { environments: 'dev' });
assert('environments 非对象拒启', badEnvType.errors.length > 0);
const emptyEnvs = loadConfig({}, { environments: {} });
assert('environments 空对象拒启', emptyEnvs.errors.length > 0);

// 24. 多环境 SSH 结构：隧道配置与秘密逐环境声明 + remoteHost 回退本环境 db.host
const sshFile = {
  defaultEnvironment: 'prod',
  environments: {
    prod: { host: 'db-internal', port: 3307, password: 'db-pw', ssh: { enabled: true, host: 'bastion', port: 2222, username: 'ops', password: 'ssh-pw', privateKey: 'KEY', passphrase: 'PP' } },
  },
};
const s = loadConfig({}, sshFile);
const sp = s.environments.prod;
assert('SSH 隧道结构逐环境解析', !s.errors.length && sp.ssh.enabled === true && sp.ssh.host === 'bastion' && sp.ssh.port === 2222);
assert('SSH 秘密来自本环境定义', sp.ssh.password === 'ssh-pw' && sp.ssh.privateKey === 'KEY' && sp.ssh.passphrase === 'PP' && sp.db.password === 'db-pw');
assert('SSH remoteHost 回退本环境 db.host、remotePort 回退 db.port', sp.ssh.remoteHost === 'db-internal' && sp.ssh.remotePort === 3307);

console.log(`\n冒烟测试: ${passed} 通过, ${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);
