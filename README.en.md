# MySQL MCP Server

[![npm version](https://img.shields.io/npm/v/mysql2-mcp-server)](https://www.npmjs.com/package/mysql2-mcp-server)
[![npm downloads](https://img.shields.io/npm/dm/mysql2-mcp-server)](https://www.npmjs.com/package/mysql2-mcp-server)
[![Node.js Version](https://img.shields.io/node/v/mysql2-mcp-server)](https://www.npmjs.com/package/mysql2-mcp-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![GitHub Issues](https://img.shields.io/github/issues/jcxy/mysql-mcp-server)](https://github.com/jcxy/mysql-mcp-server/issues)

[中文](./README.md) | English

An MCP (Model Context Protocol) server for MySQL databases. It supports both direct connections and SSH tunnels, letting AI assistants interact with MySQL databases directly.

## Features

- 🔌 **Dual connection modes**: direct connection and SSH tunnel
- 🔄 **SSH auto-reconnect**: reconnects with exponential backoff after tunnel drops
- 🔗 **Connection pool**: direct mode uses a pool for better query performance
- 🔍 **Query execution**: run SELECT queries and get results
- ✏️ **Data manipulation**: run INSERT, UPDATE, DELETE statements
- 📋 **Schema exploration**: list tables and inspect columns so the AI can understand your database quickly
- 💼 **Transactions**: BEGIN/COMMIT/ROLLBACK support (direct mode)
- 🛡️ **Security**: statement whitelist, result truncation, read-only mode
- 🌍 **Multiple environments**: configure several database connections (dev, test, prod, ...)

## Installation

### Option 1: Run with npx (recommended, no cloning needed)

No installation required — the MCP client downloads and runs it via npx automatically:

```bash
npx -y mysql2-mcp-server
```

### Option 2: Global install

```bash
npm install -g mysql2-mcp-server
mysql2-mcp-server
```

### Option 3: Run from source

```bash
git clone https://github.com/jcxy/mysql-mcp-server.git
cd mysql-mcp-server
npm install
npm start
```

## Configuration

### Option 1: Environment variables (recommended)

Pass connection settings as environment variables in your MCP client config — no code changes needed. The npx mode only supports this option.

### Option 2: Config file

Place a `config.js` in **the directory where you run the command** (copy from `config.example.js`) and it will be loaded automatically:

```bash
cp config.example.js config.js
```

Then edit `config.js` with your database credentials. Lookup order: current working directory → install directory; if neither exists, only environment variables are used.

## Using with Claude Desktop

### Config file locations

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

### Basic example (npx, recommended)

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

### Multi-environment example

Configure multiple database connections for different environments:

```json
{
  "mcpServers": {
    "mysql-prod": {
      "command": "npx",
      "args": ["-y", "mysql2-mcp-server"],
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
      "command": "npx",
      "args": ["-y", "mysql2-mcp-server"],
      "env": {
        "MYSQL_HOST": "192.168.1.100",
        "MYSQL_PORT": "3306",
        "MYSQL_USER": "dev_user",
        "MYSQL_PASSWORD": "dev_password"
      }
    },
    "mysql-test": {
      "command": "npx",
      "args": ["-y", "mysql2-mcp-server"],
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

## Environment Variables

### MySQL connection

| Variable | Description | Default |
|----------|-------------|---------|
| `MYSQL_HOST` | MySQL server host | `localhost` |
| `MYSQL_PORT` | MySQL server port | `3306` |
| `MYSQL_USER` | MySQL username | `root` |
| `MYSQL_PASSWORD` | MySQL password | - |
| `MYSQL_DATABASE` | Default database (optional) | - |
| `READ_ONLY` | Enable read-only mode (disables mysql_execute) | `false` |
| `MAX_ROWS` | Max rows returned by queries; extra rows are truncated | `1000` |

### SSH tunnel

| Variable | Description | Default |
|----------|-------------|---------|
| `SSH_ENABLED` | Enable SSH tunnel | `false` |
| `SSH_HOST` | SSH server host | - |
| `SSH_PORT` | SSH server port | `22` |
| `SSH_USERNAME` | SSH username | - |
| `SSH_PASSWORD` | SSH password (either password or private key) | - |
| `SSH_PRIVATE_KEY` | SSH private key content (either password or private key) | - |
| `SSH_PASSPHRASE` | SSH private key passphrase (optional) | - |
| `SSH_REMOTE_HOST` | Target MySQL host inside the tunnel | `localhost` |
| `SSH_REMOTE_PORT` | Target MySQL port inside the tunnel | `3306` |

## Available Tools

### mysql_query

Run read-only SQL (SELECT / SHOW / DESCRIBE / EXPLAIN / WITH...SELECT) and return the result set.

**Security limits**:
- Only read-only statements are allowed (SELECT, SHOW, DESCRIBE, EXPLAIN, WITH...SELECT)
- Results are truncated to MAX_ROWS, returning the first N rows with a truncation flag

**Parameters**:
- `sql`: the SQL query

**Response**:
```json
{
  "rows": [...],
  "truncated": false,
  "returnedRows": 10,
  "maxRows": 1000
}
```

### mysql_execute

Run a write statement (INSERT, UPDATE, DELETE) and return the affected row count.

**Note**: disabled when `READ_ONLY=true`.

**Parameters**:
- `sql`: the SQL statement

### mysql_list_tables

List all tables in the current database.

**Parameters**: none

**Response**:
```json
{
  "tables": ["users", "orders", "products"],
  "count": 3
}
```

### mysql_describe_table

Inspect a table's structure (columns, types, nullability, keys, defaults, etc.).

**Parameters**:
- `table`: the table name

**Response**:
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

Begin a transaction. All queries and updates during the transaction run on the same connection, guaranteeing atomicity.

**Note**: only direct mode supports transactions; SSH mode does not yet. Transactions cannot be started in read-only mode.

**Parameters**: none

### mysql_commit

Commit the current transaction and persist all changes.

**Parameters**: none

### mysql_rollback

Roll back the current transaction and undo all uncommitted changes.

**Parameters**: none

**Transaction example**:
1. Call `mysql_begin` to start a transaction
2. Run multiple `mysql_query` / `mysql_execute` operations
3. Call `mysql_commit` to commit, or `mysql_rollback` to roll back

## Use Cases

1. **Direct local database**: when the dev database is directly reachable
2. **SSH tunnel**: when production databases sit behind a bastion host
3. **Multi-environment**: manage several database connections in the same Claude Desktop

## Notes

- Never commit passwords or other secrets to version control
- Prefer environment variables over hard-coded config
- SSH tunnel mode is suited for intranet or protected databases
- **Read-only mode is off by default**: set `READ_ONLY=true` in production to prevent accidental AI writes
- `mysql_query` only accepts read-only statements (SELECT/SHOW/DESCRIBE/EXPLAIN/WITH...SELECT); use `mysql_execute` for changes

## Contributing

Issues and pull requests are welcome:

1. Fork the repo and create a feature branch
2. Make sure `npm test` passes before submitting
3. Open a PR describing your changes

For bug reports use the [bug report template](https://github.com/jcxy/mysql-mcp-server/issues/new?template=bug_report.yml); for feature ideas use the [feature request template](https://github.com/jcxy/mysql-mcp-server/issues/new?template=feature_request.yml).

## Release process (maintainers)

Publishing to the npm registry is automated via GitHub Actions:

```bash
npm version minor   # minor for behavior changes; patch for fixes
git push --tags
```

Pushing a `v*` tag runs the tests and publishes to npm automatically (requires `NPM_TOKEN` configured in repository Secrets).

## Changelog

### v1.3.0

- npx support: `npx -y mysql2-mcp-server`, no cloning needed (new bin entry)
- `config.js` is now optional: loaded from the current working directory; startup works without it in npx mode
- Completed npm publishing metadata in `package.json` (files whitelist, engines, repository, etc.)

### v1.2.0

**Architecture refactor**: the single-file implementation was split into modules (`lib/config.js`, `lib/backend/`, `lib/tools.js`); security enforcement (statement whitelist, read-only gate, result truncation) is now centralized in the tool dispatch choke point; added `npm test` smoke tests.

**Behavior changes**:
- Fixed: on commit/rollback failure the connection with a pending transaction is destroyed instead of returned to the pool (prevents pool pollution)
- Fixed: transaction state is cleaned up correctly when the transaction connection errors, eliminating a race condition
- `mysql_list_tables` / `mysql_describe_table` results are now truncated by `MAX_ROWS` too
- Transaction tool success messages are now JSON (`{"status": "..."}`)
- SSH error messages are now in Chinese and mention auto-reconnect status

### v1.1.0

- Security: statement whitelist, result truncation (`MAX_ROWS`), read-only mode (`READ_ONLY`)
- SSH auto-reconnect with exponential backoff
- Schema tools: `mysql_list_tables`, `mysql_describe_table`
- Connection pool and transactions: `mysql_begin` / `mysql_commit` / `mysql_rollback`

## License

MIT — see [LICENSE](./LICENSE)
