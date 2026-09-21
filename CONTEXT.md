# MySQL MCP Server

一个让 AI 助手通过 MCP 协议安全访问 MySQL 数据库的服务器，支持直连与 SSH 隧道两种连接模式。

## Language

**只读模式 (Read-only Mode)**:
一种部署模式，启用后服务器拒绝执行任何数据变更语句，仅提供查询能力。默认关闭。
_Avoid_: 只读连接、readonly connection

**语句白名单 (Statement Whitelist)**:
`mysql_query` 工具的准入规则：仅允许 SELECT、WITH（主句为 SELECT）、SHOW、DESCRIBE/DESC、EXPLAIN 开头的语句。其余一律拒绝。
_Avoid_: SQL 过滤、黑名单

**结果截断 (Result Truncation)**:
查询结果超出 `MAX_ROWS` 上限时，只返回前 N 行并附带截断提示的行为。截断不报错。
_Avoid_: 分页、limit 注入

**连接池 (Connection Pool)**:
直连模式下维护的 MySQL 连接池，复用连接以提升查询性能。池大小默认 10，可通过配置调整。
_Avoid_: 连接复用、persistent connection

**事务 (Transaction)**:
通过 `mysql_begin`/`mysql_commit`/`mysql_rollback` 控制的原子操作序列。事务期间所有操作复用同一连接。仅直连模式支持。
_Avoid_: 事务块、transaction block
