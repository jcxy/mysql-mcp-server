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
- 🛡️ **Security**: statement whitelist, result truncation, per-environment read-only mode
- 🌍 **Multi-environment**: one server instance registers dev/prod etc.; calls route explicitly via an `environment` argument
- 🔐 **Credential separation**: environment structure and permission policy are committable; secrets live in a user-home credentials file — zero secrets in the MCP config

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

### Option 1: Environment variables (single environment, easy start)

Pass connection settings as environment variables in your MCP client config — no code changes needed. The npx mode only supports this option.

### Option 2: Config file (single environment)

Place a `config.js` in **the directory where you run the command** (copy from `config.example.js`) and it will be loaded automatically:

```bash
cp config.example.js config.js
```

Then edit `config.js` with your database credentials. Lookup order: current working directory → install directory; if neither exists, only environment variables are used.

### Option 3: Multi-environment + credential separation (recommended for production)

A single MCP server registers multiple environments (e.g. dev/prod); calls route explicitly via the `environment` argument. **Credential separation**: environment structure and read-only policy live in the committable `config.js`, while secrets live in a user-home credentials file — zero secrets in the MCP config. See the [multi-environment example](#multi-environment-example) below.

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

A single MCP server registers dev and prod with credential separation: environment structure and read-only policy in `config.js`, passwords in the user-home credentials file.

**Step 1: write `config.js`** (committable, contains no secrets):

```js
export default {
  defaultEnvironment: 'dev',
  environments: {
    dev: {
      host: '192.168.1.100',
      port: 3306,
      user: 'dev_user',       // dev uses your full-privilege account; the AI can run DDL/DML freely
      database: 'devdb',
      readOnly: false,
      maxRows: 1000,
    },
    prod: {
      host: '10.0.0.5',
      port: 3306,
      user: 'ai_readonly',    // dedicated least-privilege read-only account (see "Hardening production reads")
      database: 'proddb',
      readOnly: true,         // MCP-side UX layer: mysql_execute / mysql_begin disabled on prod
      maxRows: 100,
    },
  },
};
```

**Step 2: write the credentials file** `~/.mysql-mcp/credentials.json` (secrets only, never committed):

```json
{
  "dev":  { "password": "dev_password" },
  "prod": { "password": "readonly_password" }
}
```

On Linux/macOS tighten permissions: `chmod 600 ~/.mysql-mcp/credentials.json` (the Windows user profile is readable only by you by default). The path can be overridden with the `MYSQL_MCP_CREDENTIALS_FILE` environment variable. When the credentials file is absent, the server falls back to passwords from environment variables / `config.js` (legacy compatibility) and does not block startup.

**Step 3: MCP client config with zero secrets**:

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

> Note: `config.js` must be in **the directory where the command runs** (for npx, the MCP client's working directory at startup; for source installs, the repo root).

Once configured, the AI selects an environment via the `environment` argument: omitting it falls back to `defaultEnvironment`; an unregistered name returns an error listing the available environments — no silent misrouting. Every tool response echoes the environment it actually ran against.

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
| `MYSQL_MCP_CREDENTIALS_FILE` | Credentials file path (multi-environment + credential separation mode) | `~/.mysql-mcp/credentials.json` |

> In the multi-environment format, `MYSQL_*`/`SSH_*` environment variables do NOT apply to environment definitions (structure comes only from `config.js`); they only apply in the single-environment (legacy) format.

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

All tools accept an optional `environment` argument that routes to a registered environment (falling back to `defaultEnvironment`); every successful response echoes the environment it ran against:

### mysql_query

Run read-only SQL (SELECT / SHOW / DESCRIBE / EXPLAIN / WITH...SELECT) and return the result set.

**Security limits**:
- Only read-only statements are allowed (SELECT, SHOW, DESCRIBE, EXPLAIN, WITH...SELECT)
- Results are truncated to the environment's maxRows, returning the first N rows with a truncation flag

**Parameters**:
- `sql`: the SQL query
- `environment`: target environment name (optional)

**Response**:
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

Run a write statement (INSERT, UPDATE, DELETE) and return the affected row count.

**Note**: fully disabled when the target environment has `readOnly: true` (including SELECT-shaped statements — use `mysql_query` for reads).

**Parameters**:
- `sql`: the SQL statement
- `environment`: target environment name (optional)

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

Begin a transaction. All queries and updates during the transaction run on the same connection, guaranteeing atomicity. Transaction state is isolated per environment; `mysql_commit` / `mysql_rollback` must pass the same `environment`.

**Note**: only direct mode supports transactions; SSH mode does not yet. Transactions cannot be started in read-only environments.

**Parameters**:
- `environment`: target environment name (optional)

### mysql_commit

Commit the current transaction and persist all changes.

**Parameters**:
- `environment`: target environment name (optional)

### mysql_rollback

Roll back the current transaction and undo all uncommitted changes.

**Parameters**:
- `environment`: target environment name (optional)

**Transaction example**:
1. Call `mysql_begin` to start a transaction
2. Run multiple `mysql_query` / `mysql_execute` operations
3. Call `mysql_commit` to commit, or `mysql_rollback` to roll back

## Use Cases

1. **Direct local database**: when the dev database is directly reachable
2. **SSH tunnel**: when production databases sit behind a bastion host (dev direct + prod via tunnel can coexist in one instance)
3. **Single-instance multi-environment**: one MCP server registers dev/prod with credential separation and per-environment permissions

## Hardening production reads (recommended)

If the AI only needs to query prod, **the most reliable protection is a least-privilege read-only account on the database side** — the only unbypassable layer: even if the MCP process itself is compromised, the MySQL server still rejects writes:

```sql
-- Create an account that can only read the target schema (restrict host to the MCP source address, as narrow as possible)
CREATE USER 'ai_readonly'@'<mcp-source-host>' IDENTIFIED BY '<strong-password>';
GRANT SELECT, SHOW VIEW ON proddb.* TO 'ai_readonly'@'<mcp-source-host>';
FLUSH PRIVILEGES;
```

Then point the prod environment at that account and enable `readOnly: true` (the MCP-side UX layer: intercepts early with a friendly error, saving the AI wasted round-trips).

> **Security boundary statement**: the in-process statement whitelist and readOnly gate are defense-in-depth and UX optimization, **not** a security boundary — statement-level bypass tricks (multi-statements, comment obfuscation) always exist. Do not rely on the `readOnly` setting alone to protect production data; the hard guarantee must come from a least-privilege database account.

## Notes

- Never commit passwords or other secrets to version control: use the credentials file for multi-environment mode (user home, not committed) and environment variables for single-environment mode
- Tighten credentials file permissions: Linux/macOS `chmod 600 ~/.mysql-mcp/credentials.json`
- SSH tunnel mode is suited for intranet or protected databases; connections are established lazily — environments never queried never connect
- **Read-only mode is off by default**: for production, combine a database-side read-only account with `readOnly: true` (see "Hardening production reads" above)
- `mysql_query` only accepts read-only statements (SELECT/SHOW/DESCRIBE/EXPLAIN/WITH...SELECT); use `mysql_execute` for changes
- Legacy single-connection configs need no changes after upgrading: they map automatically to a single environment named `default`, behavior unchanged

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

### v1.4.0

**Multi-environment + credential separation + per-environment permissions**:

- Single-instance multi-environment: one MCP server registers multiple environments (`environments` + `defaultEnvironment`); all tools accept an optional `environment` argument with explicit routing; responses echo the environment used
- Credential separation: environment structure and readOnly policy live in the committable `config.js`; passwords/SSH keys live in the user-home credentials file (`~/.mysql-mcp/credentials.json`, path overridable via `MYSQL_MCP_CREDENTIALS_FILE`) — zero secrets in the MCP client config
- Per-environment read-only mode: `mysql_execute` / `mysql_begin` are fully disabled in readOnly environments; docs provide the standard least-privilege read-only account grants (the only unbypassable layer)
- Independent connection pool / SSH tunnel / transaction state per environment; lazy connections (zero connections at startup; never-queried environments never connect); one environment's failure does not affect others
- Startup structural validation: invalid environment names, missing default-environment declaration, etc. refuse to start
- Backward compatible: legacy single-connection configs and pure environment-variable setups map automatically to a single `default` environment — zero changes on upgrade

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
