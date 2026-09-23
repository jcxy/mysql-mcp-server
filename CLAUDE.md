# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

一个 MySQL MCP (Model Context Protocol) 服务器，使 AI 助手能够与 MySQL 数据库交互。支持直连 MySQL 和 SSH 隧道两种连接模式。

## 常用命令

```bash
# 安装依赖
npm install

# 运行服务器 (需要 MCP 客户端如 Claude Desktop)
node index.js

# 运行测试
npm test
```

## 架构

**模块划分**（每个模块可通过自己的接口独立测试）:
- `index.js` — 组装入口：加载配置、选定后端、装配 MCP 服务器；含入口守卫，可被测试导入而不启动
- `lib/config.js` — 配置解析纯函数 `loadConfig(env, fileConfig)`
- `lib/backend/pool-backend.js` — 直连模式后端（连接池 + 事务状态私有化）
- `lib/backend/ssh-backend.js` — SSH 隧道后端（forwardOut 临时连接 + 指数退避重连）
- `lib/tools.js` — 工具定义与 `handleToolCall(name, args, deps)` 分派（咽喉点：白名单、只读门控、结果截断统一在此强制）
- `lib/validation.js` — 语句白名单、MAX_ROWS 解析、结果截断（纯函数）

**后端统一接口**: `init / query / execute / begin / commit / rollback`——部署模式在启动时一次性选定，运行期不再感知 SSH 与直连的差异

**两种连接模式**:
1. **直连模式**: mysql2 连接池 (connectionLimit: 10)，支持事务
2. **SSH 隧道模式**: 每次查询经 forwardOut 建立临时连接，断线自动重连，不支持事务

**配置来源** (优先级从高到低):
1. 环境变量 (推荐，在 MCP 客户端配置中设置)
2. `config.js` 文件 (从 `config.example.js` 复制)

**提供的 MCP 工具**:
- `mysql_query`: 只读查询（语句白名单），返回 `{rows, truncated, returnedRows, maxRows}`
- `mysql_execute`: 执行 INSERT/UPDATE/DELETE，返回 `{affectedRows, insertId}`
- `mysql_list_tables` / `mysql_describe_table`: schema 探索
- `mysql_begin` / `mysql_commit` / `mysql_rollback`: 事务控制（仅直连模式）

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `MYSQL_HOST` | MySQL 服务器地址 | localhost |
| `MYSQL_PORT` | MySQL 服务器端口 | 3306 |
| `MYSQL_USER` | MySQL 用户名 | root |
| `MYSQL_PASSWORD` | MySQL 密码 | - |
| `MYSQL_DATABASE` | 默认数据库 | - |
| `SSH_ENABLED` | 是否启用 SSH 隧道 | false |
| `SSH_HOST` | SSH 服务器地址 | - |
| `SSH_PORT` | SSH 服务器端口 | 22 |
| `SSH_USERNAME` | SSH 用户名 | - |
| `SSH_PASSWORD` | SSH 密码 | - |
| `SSH_PRIVATE_KEY` | SSH 私钥内容 | - |
| `SSH_REMOTE_HOST` | SSH 隧道内的 MySQL 地址 | localhost |
| `SSH_REMOTE_PORT` | SSH 隧道内的 MySQL 端口 | 3306 |

## Agent skills

### Issue tracker

Issues live in GitHub Issues for `jcxy/mysql-mcp-server`. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context layout: one `CONTEXT.md` + `docs/adr/` at repo root. See `docs/agents/domain.md`.