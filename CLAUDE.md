# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

一个 MySQL MCP (Model Context Protocol) 服务器，使 AI 助手能够与 MySQL 数据库交互。支持直连 MySQL 和 SSH 隧道两种连接模式。使用 TypeScript 构建。

## 常用命令

```bash
# 安装依赖
npm install

# 开发模式（自动重新编译）
npm run dev

# 构建
npm run build

# 运行服务器 (需要 MCP 客户端如 Claude Desktop)
npm start
```

## 架构

```
src/
├── index.ts      # 主入口，MCP 服务器定义和工具注册
├── types.ts      # TypeScript 类型定义
├── schemas.ts    # Zod 输入验证 schemas
├── config.ts     # 配置管理（从环境变量读取）
└── mysql.ts      # MySQL 服务类（支持直连和 SSH 隧道）
```

**入口文件**: `dist/index.js` - 编译后的主入口

**两种连接模式**:
1. **直连模式**: 直接连接 MySQL 服务器 (通过 `MYSQL_HOST`, `MYSQL_PORT` 等配置)
2. **SSH 隧道模式**: 通过 SSH 跳板机连接 (通过 `SSH_ENABLED=true` 启用)

**配置来源**: 仅通过环境变量配置（推荐在 MCP 客户端配置中设置）

**提供的 MCP 工具**:
- `mysql_query`: 执行 SELECT 查询，返回 `{rows, rowCount}`
- `mysql_execute`: 执行 INSERT/UPDATE/DELETE，返回 `{affectedRows, insertId}`

**连接流程**:
1. 启动时，若 `SSH_ENABLED=true`，先建立 SSH 连接
2. 每次查询创建新连接（非连接池），查询完成后关闭

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