# MySQL MCP Server

一个用于连接 MySQL 数据库的 MCP (Model Context Protocol) 服务器，支持直连和 SSH 隧道两种连接方式，让 AI 助手能够直接与 MySQL 数据库交互。

## 功能特性

- **双连接模式**: 支持直接连接和 SSH 隧道连接
- **查询执行**: 执行 SELECT 查询并返回结果
- **数据操作**: 执行 INSERT、UPDATE、DELETE 等语句
- **多环境支持**: 可配置多个数据库连接（开发、测试、生产等）
- **类型安全**: 使用 TypeScript 构建，提供完整的类型定义

## 安装

```bash
# 克隆仓库
git clone https://github.com/your-username/mysql-mcp-server.git

# 进入目录
cd mysql-mcp-server

# 安装依赖
npm install

# 构建
npm run build
```

## 开发

```bash
# 开发模式（自动重新编译）
npm run dev

# 构建
npm run build

# 运行
npm start
```

## 配置方式

通过环境变量传递数据库连接信息，无需修改代码。

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
      "args": ["/path/to/mysql-mcp-server/dist/index.js"],
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
      "args": ["/path/to/mysql-mcp-server/dist/index.js"],
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
      "args": ["/path/to/mysql-mcp-server/dist/index.js"],
      "env": {
        "MYSQL_HOST": "192.168.1.100",
        "MYSQL_PORT": "3306",
        "MYSQL_USER": "dev_user",
        "MYSQL_PASSWORD": "dev_password"
      }
    },
    "mysql-test": {
      "command": "node",
      "args": ["/path/to/mysql-mcp-server/dist/index.js"],
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

执行 SQL 查询语句（SELECT），返回查询结果。

**参数**:
- `sql`: SQL 查询语句

**返回**:
```json
{
  "rows": [...],
  "rowCount": 10
}
```

**示例**:
```sql
SELECT * FROM users WHERE id = 1
```

### mysql_execute

执行 SQL 更新语句（INSERT、UPDATE、DELETE），返回影响的行数。

**参数**:
- `sql`: SQL 执行语句

**返回**:
```json
{
  "affectedRows": 1,
  "insertId": 123
}
```

**示例**:
```sql
INSERT INTO users (name, email) VALUES ('张三', 'zhangsan@example.com')
```

## 项目结构

```
mysql-mcp-server/
├── src/
│   ├── index.ts      # 主入口
│   ├── types.ts      # 类型定义
│   ├── schemas.ts    # Zod 验证
│   ├── config.ts     # 配置管理
│   └── mysql.ts      # MySQL 服务
├── dist/             # 编译输出
├── package.json
└── tsconfig.json
```

## 使用场景

1. **直连本地数据库**: 开发环境数据库可直接访问时使用
2. **SSH 隧道连接**: 生产数据库需要通过跳板机访问时使用
3. **多环境管理**: 在同一 Claude Desktop 中配置多个数据库连接

## 注意事项

- 密码等敏感信息请勿提交到版本控制
- 建议使用环境变量方式配置，避免硬编码
- SSH 隧道模式适合连接内网或受保护的数据库

## License

MIT