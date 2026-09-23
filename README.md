# MySQL MCP Server

一个用于连接 MySQL 数据库的 MCP (Model Context Protocol) 服务器，支持直连和 SSH 隧道两种连接方式，让 AI 助手能够直接与 MySQL 数据库交互。

## 功能特性

- 🔌 **双连接模式**: 支持直接连接和 SSH 隧道连接
- 🔄 **SSH 自动重连**: SSH 隧道断线后自动重连（指数退避）
- 🔗 **连接池**: 直连模式使用连接池，提升查询性能
- 🔍 **查询执行**: 执行 SELECT 查询并返回结果
- ✏️ **数据操作**: 执行 INSERT、UPDATE、DELETE 等语句
- 📋 **Schema 探索**: 列出表、查看表结构，帮助 AI 快速了解数据库
- 💼 **事务支持**: 支持 BEGIN/COMMIT/ROLLBACK（直连模式）
- 🛡️ **安全机制**: 语句白名单、结果截断、只读模式
- 🌍 **多环境支持**: 可配置多个数据库连接（开发、测试、生产等）

## 安装

```bash
# 克隆仓库
git clone https://github.com/jcxy/mysql-mcp-server.git

# 进入目录
cd mysql-mcp-server

# 安装依赖
npm install
```

## 配置方式

### 方式一：环境变量（推荐）

在 MCP 客户端配置中通过环境变量传递数据库连接信息，无需修改代码。

### 方式二：配置文件

复制配置模板并修改：

```bash
cp config.example.js config.js
```

然后编辑 `config.js` 文件填入你的数据库信息。

## 在 Claude Desktop 中使用

### 配置文件位置

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

### 基础配置示例

```json
{
  "mcpServers": {
    "mysql": {
      "command": "node",
      "args": ["/path/to/mysql-mcp-server/index.js"],
      "env": {
        "MYSQL_HOST": "localhost",
        "MYSQL_PORT": "3306",
        "MYSQL_USER": "root",
        "MYSQL_PASSWORD": "your_password",
        "MYSQL_DATABASE": "your_database"
      }
    }
  }
}
```

### 多环境配置示例

配置多个数据库连接，分别对应不同的环境：

```json
{
  "mcpServers": {
    "mysql-prod": {
      "command": "node",
      "args": ["/path/to/mysql-mcp-server/index.js"],
      "env": {
        "SSH_ENABLED": "true",
        "SSH_HOST": "ssh.example.com",
        "SSH_PORT": "22",
        "SSH_USERNAME": "ssh_user",
        "SSH_PASSWORD": "ssh_password",
        "SSH_REMOTE_HOST": "127.0.0.1",
        "SSH_REMOTE_PORT": "3306",
        "MYSQL_USER": "db_user",
        "MYSQL_PASSWORD": "db_password"
      }
    },
    "mysql-dev": {
      "command": "node",
      "args": ["/path/to/mysql-mcp-server/index.js"],
      "env": {
        "MYSQL_HOST": "192.168.1.100",
        "MYSQL_PORT": "3306",
        "MYSQL_USER": "dev_user",
        "MYSQL_PASSWORD": "dev_password"
      }
    },
    "mysql-test": {
      "command": "node",
      "args": ["/path/to/mysql-mcp-server/index.js"],
      "env": {
        "MYSQL_HOST": "192.168.1.101",
        "MYSQL_PORT": "3306",
        "MYSQL_USER": "test_user",
        "MYSQL_PASSWORD": "test_password"
      }
    }
  }
}
```

## 环境变量说明

### MySQL 连接配置

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `MYSQL_HOST` | MySQL 服务器地址 | `localhost` |
| `MYSQL_PORT` | MySQL 服务器端口 | `3306` |
| `MYSQL_USER` | MySQL 用户名 | `root` |
| `MYSQL_PASSWORD` | MySQL 密码 | - |
| `MYSQL_DATABASE` | 默认数据库（可选） | - |
| `READ_ONLY` | 是否启用只读模式（禁用 mysql_execute） | `false` |
| `MAX_ROWS` | 查询结果最大行数，超出将截断 | `1000` |

### SSH 隧道配置

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `SSH_ENABLED` | 是否启用 SSH 隧道 | `false` |
| `SSH_HOST` | SSH 服务器地址 | - |
| `SSH_PORT` | SSH 服务器端口 | `22` |
| `SSH_USERNAME` | SSH 用户名 | - |
| `SSH_PASSWORD` | SSH 密码（与私钥二选一） | - |
| `SSH_PRIVATE_KEY` | SSH 私钥内容（与密码二选一） | - |
| `SSH_PASSPHRASE` | SSH 私钥密码（可选） | - |
| `SSH_REMOTE_HOST` | 隧道目标 MySQL 地址 | `localhost` |
| `SSH_REMOTE_PORT` | 隧道目标 MySQL 端口 | `3306` |

## 可用工具

### mysql_query

执行 SQL 查询语句（SELECT/SHOW/DESCRIBE/EXPLAIN/WITH...SELECT），返回查询结果。

**安全限制**:
- 仅允许只读语句（SELECT、SHOW、DESCRIBE、EXPLAIN、WITH...SELECT）
- 结果超过 MAX_ROWS 行时自动截断，返回前 N 行并附带截断标记

**参数**:
- `sql`: SQL 查询语句

**返回格式**:
```json
{
  "rows": [...],
  "truncated": false,
  "returnedRows": 10,
  "maxRows": 1000
}
```

### mysql_execute

执行 SQL 更新语句（INSERT、UPDATE、DELETE），返回影响的行数。

**注意**: 当 `READ_ONLY=true` 时，此工具将被禁用。

**参数**:
- `sql`: SQL 执行语句

### mysql_list_tables

列出当前数据库中的所有表。

**参数**: 无

**返回格式**:
```json
{
  "tables": ["users", "orders", "products"],
  "count": 3
}
```

### mysql_describe_table

查看指定表的结构（列名、类型、是否可空、键信息、默认值等）。

**参数**:
- `table`: 要查看结构的表名

**返回格式**:
```json
{
  "table": "users",
  "columns": [
    {
      "Field": "id",
      "Type": "int(11)",
      "Null": "NO",
      "Key": "PRI",
      "Default": null,
      "Extra": "auto_increment"
    }
  ]
}
```

### mysql_begin

开始一个事务。事务期间的所有查询和更新操作都在同一连接上执行，保证原子性。

**注意**: 仅直连模式支持事务，SSH 模式暂不支持。只读模式下不能开启事务。

**参数**: 无

### mysql_commit

提交当前事务，将所有更改持久化。

**参数**: 无

### mysql_rollback

回滚当前事务，撤销所有未提交的更改。

**参数**: 无

**事务使用示例**:
1. 调用 `mysql_begin` 开始事务
2. 执行多个 `mysql_query` / `mysql_execute` 操作
3. 调用 `mysql_commit` 提交或 `mysql_rollback` 回滚

## 使用场景

1. **直连本地数据库**: 开发环境数据库可直接访问时使用
2. **SSH 隧道连接**: 生产数据库需要通过跳板机访问时使用
3. **多环境管理**: 在同一 Claude Desktop 中配置多个数据库连接

## 注意事项

- 密码等敏感信息请勿提交到版本控制
- 建议使用环境变量方式配置，避免硬编码
- SSH 隧道模式适合连接内网或受保护的数据库
- **默认非只读模式**：生产环境建议设置 `READ_ONLY=true` 防止 AI 误操作
- `mysql_query` 仅允许只读语句（SELECT/SHOW/DESCRIBE/EXPLAIN/WITH...SELECT），变更语句请使用 `mysql_execute`

## 变更记录

### v1.2.0

**架构重构**：单文件拆分为模块化结构（`lib/config.js`、`lib/backend/`、`lib/tools.js`），安全强制（语句白名单、只读门控、结果截断）统一收敛到工具分派咽喉点，并新增 `npm test` 冒烟测试。

**行为变更**：
- 修复：事务提交/回滚失败时，未决事务的连接不再归还连接池（改为销毁），避免污染池中连接
- 修复：事务连接异常断开时正确清理事务状态，消除竞态
- `mysql_list_tables` / `mysql_describe_table` 结果也受 `MAX_ROWS` 截断
- 事务工具成功消息改为 JSON 格式（`{"status": "..."}`）
- SSH 错误消息改为中文并注明自动重连状态

### v1.1.0

- 安全机制：语句白名单、结果截断（`MAX_ROWS`）、只读模式（`READ_ONLY`）
- SSH 断线自动重连（指数退避）
- Schema 探索工具：`mysql_list_tables`、`mysql_describe_table`
- 连接池与事务支持：`mysql_begin` / `mysql_commit` / `mysql_rollback`

## License

MIT