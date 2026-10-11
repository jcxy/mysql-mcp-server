# MySQL MCP Server

[![npm version](https://img.shields.io/npm/v/mysql2-mcp-server)](https://www.npmjs.com/package/mysql2-mcp-server)
[![npm downloads](https://img.shields.io/npm/dm/mysql2-mcp-server)](https://www.npmjs.com/package/mysql2-mcp-server)
[![Node.js Version](https://img.shields.io/node/v/mysql2-mcp-server)](https://www.npmjs.com/package/mysql2-mcp-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![GitHub Issues](https://img.shields.io/github/issues/jcxy/mysql-mcp-server)](https://github.com/jcxy/mysql-mcp-server/issues)

中文 | [English](./README.en.md)

> 🌐 **English documentation**: see [README.en.md](./README.en.md)

一个用于连接 MySQL 数据库的 MCP (Model Context Protocol) 服务器，支持直连和 SSH 隧道两种连接方式，让 AI 助手能够直接与 MySQL 数据库交互。

## 功能特性

- 🔌 **双连接模式**: 支持直接连接和 SSH 隧道连接
- 🔄 **SSH 自动重连**: SSH 隧道断线后自动重连（指数退避）
- 🔗 **连接池**: 直连模式使用连接池，提升查询性能
- 🔍 **查询执行**: 执行 SELECT 查询并返回结果
- ✏️ **数据操作**: 执行 INSERT、UPDATE、DELETE 等语句
- 📋 **Schema 探索**: 列出表、查看表结构，帮助 AI 快速了解数据库
- 💼 **事务支持**: 支持 BEGIN/COMMIT/ROLLBACK（直连模式）
- 🛡️ **安全机制**: 语句白名单、结果截断、按环境只读模式
- 🌍 **多环境支持**: 单实例同时注册 dev/prod 等多环境，调用时显式 `environment` 参数路由
- 🔐 **凭据分离**: 环境结构与权限策略可提交共享，密码等秘密存放在用户主目录凭据文件，MCP 配置零秘密

## 安装

### 方式一：npx 直接运行（推荐，无需克隆仓库）

无需安装，MCP 客户端会通过 npx 自动下载并运行：

```bash
npx -y mysql2-mcp-server
```

### 方式二：全局安装

```bash
npm install -g mysql2-mcp-server
mysql2-mcp-server
```

### 方式三：从源码运行

```bash
git clone https://github.com/jcxy/mysql-mcp-server.git
cd mysql-mcp-server
npm install
npm start
```

## 配置方式

### 方式一：环境变量（单环境，推荐入门）

在 MCP 客户端配置中通过环境变量传递数据库连接信息，无需修改代码。npx 方式只能使用这种方式。

### 方式二：配置文件（单环境）

在**运行命令时所在的目录**放置 `config.js`（从 `config.example.js` 复制修改），服务器会自动加载：

```bash
cp config.example.js config.js
```

然后编辑 `config.js` 文件填入你的数据库信息。查找顺序：当前工作目录 → 安装目录；均不存在时仅使用环境变量。

### 方式三：多环境 + 凭据分离（推荐生产使用）

单个 MCP 服务器同时注册多个环境（如 dev/prod），调用时通过 `environment` 参数显式路由。**凭据分离**：环境结构与权限策略写在可提交的 `config.js`，密码等秘密写在用户主目录的凭据文件，MCP 配置中零秘密。详见下方[多环境配置示例](#多环境配置示例)。

## 在 Claude Desktop 中使用

### 配置文件位置

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

### 基础配置示例（npx 方式，推荐）

```json
{
  "mcpServers": {
    "mysql": {
      "command": "npx",
      "args": ["-y", "mysql2-mcp-server"],
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

单个 MCP 服务器同时注册 dev/prod 两个环境，凭据分离：环境结构与只读策略写在 `config.js`，密码写在用户主目录凭据文件。

**第一步：编写 `config.js`**（可提交到仓库，不含任何秘密）：

```js
export default {
  defaultEnvironment: 'dev',
  environments: {
    dev: {
      host: '192.168.1.100',
      port: 3306,
      user: 'dev_user',       // dev 与你的账号权限一致，AI 可自由执行 DDL/DML
      database: 'devdb',
      readOnly: false,
      maxRows: 1000,
    },
    prod: {
      host: '10.0.0.5',
      port: 3306,
      user: 'ai_readonly',    // 专用最小权限只读账号（见下方「生产环境只读加固」）
      database: 'proddb',
      readOnly: true,         // MCP 侧体验层：prod 禁用 mysql_execute / mysql_begin
      maxRows: 100,
    },
  },
};
```

**第二步：编写凭据文件** `~/.mysql-mcp/credentials.json`（纯秘密，不进仓库）：

```json
{
  "dev":  { "password": "dev_password" },
  "prod": { "password": "readonly_password" }
}
```

Linux/macOS 建议收紧权限：`chmod 600 ~/.mysql-mcp/credentials.json`（Windows 用户目录默认仅本人可读）。路径可通过环境变量 `MYSQL_MCP_CREDENTIALS_FILE` 覆盖；凭据文件不存在时降级为环境变量/config.js 中的密码（旧格式兼容），不阻断启动。

**第三步：MCP 客户端配置零秘密**：

```json
{
  "mcpServers": {
    "mysql": {
      "command": "npx",
      "args": ["-y", "mysql2-mcp-server"]
    }
  }
}
```

> 注意：`config.js` 需放在**运行命令时所在的目录**（npx 场景即 MCP 客户端启动时的工作目录；源码场景即仓库根目录）。

配置完成后，AI 调用工具时通过 `environment` 参数选择环境：不传参数落到 `defaultEnvironment`；传入未注册的环境名会得到列出可用环境的错误，不会静默错位。每个工具的返回值都回显实际作用的环境名，方便你随时确认 AI 正在碰哪个环境。

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
| `MYSQL_MCP_CREDENTIALS_FILE` | 凭据文件路径（多环境 + 凭据分离模式） | `~/.mysql-mcp/credentials.json` |

> 多环境格式下 `MYSQL_*`/`SSH_*` 环境变量不作用于环境定义（环境结构仅来自 `config.js`）；它们仅在单环境（旧格式）下生效。

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

所有工具均支持可选的 `environment` 参数路由到已注册环境（未传时使用 `defaultEnvironment`），成功返回均回显实际作用的环境名：

### mysql_query

执行 SQL 查询语句（SELECT/SHOW/DESCRIBE/EXPLAIN/WITH...SELECT），返回查询结果。

**安全限制**:
- 仅允许只读语句（SELECT、SHOW、DESCRIBE、EXPLAIN、WITH...SELECT）
- 结果超过该环境的 maxRows 行时自动截断，返回前 N 行并附带截断标记

**参数**:
- `sql`: SQL 查询语句
- `environment`: 目标环境名（可选）

**返回格式**:
```json
{
  "environment": "dev",
  "rows": [...],
  "truncated": false,
  "returnedRows": 10,
  "maxRows": 1000
}
```

### mysql_execute

执行 SQL 更新语句（INSERT、UPDATE、DELETE），返回影响的行数。

**注意**: 当目标环境的 `readOnly: true` 时，此工具将被整体禁用（包括 SELECT 形式的语句，读数据请使用 `mysql_query`）。

**参数**:
- `sql`: SQL 执行语句
- `environment`: 目标环境名（可选）

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

开始一个事务。事务期间的所有查询和更新操作都在同一连接上执行，保证原子性。事务状态按环境隔离，`mysql_commit` / `mysql_rollback` 需传相同 `environment`。

**注意**: 仅直连模式支持事务，SSH 模式暂不支持。只读环境下不能开启事务。

**参数**:
- `environment`: 目标环境名（可选）

### mysql_commit

提交当前事务，将所有更改持久化。

**参数**:
- `environment`: 目标环境名（可选）

### mysql_rollback

回滚当前事务，撤销所有未提交的更改。

**参数**:
- `environment`: 目标环境名（可选）

**事务使用示例**:
1. 调用 `mysql_begin` 开始事务
2. 执行多个 `mysql_query` / `mysql_execute` 操作
3. 调用 `mysql_commit` 提交或 `mysql_rollback` 回滚

## 使用场景

1. **直连本地数据库**: 开发环境数据库可直接访问时使用
2. **SSH 隧道连接**: 生产数据库需要通过跳板机访问时使用（dev 直连 + prod 走 SSH 隧道可共存于同一实例）
3. **单实例多环境管理**: 一个 MCP 服务器同时注册 dev/prod，凭据分离 + 按环境权限

## 生产环境只读加固（推荐）

如果 AI 只需要查询 prod，**最可靠的防护是在数据库侧创建最小权限只读账号**——这是唯一不可绕过的层，即使 MCP 进程本身被攻破，MySQL 服务器仍会拒绝写操作：

```sql
-- 创建仅能查询目标库的账号（host 限定为 MCP 运行来源地址，越窄越好）
CREATE USER 'ai_readonly'@'<mcp来源host>' IDENTIFIED BY '<强密码>';
GRANT SELECT, SHOW VIEW ON proddb.* TO 'ai_readonly'@'<mcp来源host>';
FLUSH PRIVILEGES;
```

然后在多环境配置中让 prod 使用该账号，并开启 `readOnly: true`（MCP 侧体验层：提前拦截并给出友好错误，避免 AI 浪费轮次）。

> **安全边界声明**：MCP 进程内的语句白名单与 readOnly 门禁是纵深防御与体验优化，**不是**安全边界——多语句、注释混淆等语句级绕过手段始终存在。不要仅依赖 `readOnly` 配置来保护生产数据；硬保证必须来自数据库侧的最小权限账号。

## 注意事项

- 密码等敏感信息请勿提交到版本控制：多环境模式推荐凭据文件（用户主目录，不进仓库），单环境模式推荐环境变量
- 凭据文件建议收紧权限：Linux/macOS `chmod 600 ~/.mysql-mcp/credentials.json`
- SSH 隧道模式适合连接内网或受保护的数据库；连接按需惰性建立，未被查询的环境不会建连
- **默认非只读**：生产环境建议数据库侧只读账号 + `readOnly: true` 双层防护（见上方「生产环境只读加固」）
- `mysql_query` 仅允许只读语句（SELECT/SHOW/DESCRIBE/EXPLAIN/WITH...SELECT），变更语句请使用 `mysql_execute`
- 旧版单连接配置升级后无需任何修改：自动映射为名为 `default` 的单一环境，行为不变

## 贡献

欢迎提交 Issue 和 Pull Request：

1. Fork 本仓库并创建特性分支
2. 提交前请确保 `npm test` 全部通过
3. 提交 PR 并描述变更内容

Bug 反馈请使用 [Bug 报告模板](https://github.com/jcxy/mysql-mcp-server/issues/new?template=bug_report.yml)，功能建议请使用[功能建议模板](https://github.com/jcxy/mysql-mcp-server/issues/new?template=feature_request.yml)。

## 发布流程（维护者）

推送到 npm registry 由 GitHub Actions 自动完成：

```bash
npm version minor   # 行为变更用 minor；纯修复用 patch
git push --tags
```

推送 `v*` 标签后会自动运行测试并发布到 npm（需在仓库 Secrets 中配置 `NPM_TOKEN`）。

## 变更记录

### v1.4.0

**多环境支持 + 凭据分离 + 按环境权限**：

- 单实例多环境：一个 MCP 服务器同时注册多个环境（`environments` + `defaultEnvironment`），所有工具支持可选 `environment` 参数显式路由，返回值回显实际作用环境名
- 凭据分离：环境结构与 readOnly 策略写在可提交的 `config.js`，密码/SSH 私钥存放在用户主目录凭据文件（`~/.mysql-mcp/credentials.json`，路径可用 `MYSQL_MCP_CREDENTIALS_FILE` 覆盖），MCP 客户端配置零秘密
- 按环境只读模式：readOnly 环境下 `mysql_execute` / `mysql_begin` 整体禁用；配套文档提供数据库侧最小权限只读账号的标准授权语句（唯一不可绕过的防护层）
- 每环境独立连接池/SSH 隧道/事务状态，惰性建连（启动零连接，未被查询的环境不建连），单环境故障不影响其他环境
- 启动期结构校验：非法环境名、多环境缺默认环境声明等配置错误直接拒启
- 向后兼容：旧版单连接配置与纯环境变量方式自动映射为 `default` 单环境，升级零改动

### v1.3.0

- 支持 npx 运行：`npx -y mysql2-mcp-server`，无需克隆仓库（新增 bin 入口）
- `config.js` 改为可选：从当前工作目录加载，npx 场景下不存在也不影响启动
- `package.json` 补全 npm 发布元数据（files 白名单、engines、repository 等）

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