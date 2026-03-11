#!/usr/bin/env node
/**
 * MySQL MCP Server
 *
 * An MCP server that enables AI assistants to interact with MySQL databases.
 * Supports both direct connections and SSH tunnel connections.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { MySQLQuerySchema, MySQLExecuteSchema } from './schemas.js';
import { getSSHConfig, getMySQLConfig } from './config.js';
import { MySQLService } from './mysql.js';
import type { MySQLQueryInput, MySQLExecuteInput } from './schemas.js';

// Initialize configuration
const sshConfig = getSSHConfig();
const mysqlConfig = getMySQLConfig();

// Create MySQL service instance
const mysqlService = new MySQLService(sshConfig, mysqlConfig);

// Create MCP server instance
const server = new McpServer({
  name: 'mysql-mcp-server',
  version: '1.0.0',
});

// Register mysql_query tool
server.registerTool(
  'mysql_query',
  {
    title: 'Execute MySQL Query',
    description: `Execute a SELECT query on the MySQL database and return the results.

This tool is for reading data from the database. It executes SELECT statements and returns the matching rows.

Args:
  - sql (string): The SQL SELECT query to execute

Returns:
  JSON object with the following structure:
  {
    "rows": [...],      // Array of row objects
    "rowCount": number  // Number of rows returned
  }

Examples:
  - SELECT * FROM users WHERE id = 1
  - SELECT name, email FROM users WHERE active = true ORDER BY created_at DESC LIMIT 10

Error Handling:
  - Returns error message if SQL syntax is invalid
  - Returns error if table or column does not exist
  - Returns error if database connection fails`,
    inputSchema: MySQLQuerySchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (params: MySQLQueryInput) => {
    try {
      const rows = await mysqlService.query(params.sql);
      const output = {
        rows,
        rowCount: rows.length,
      };

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(output, null, 2),
          },
        ],
        structuredContent: output,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${message}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Register mysql_execute tool
server.registerTool(
  'mysql_execute',
  {
    title: 'Execute MySQL Statement',
    description: `Execute an INSERT, UPDATE, or DELETE statement on the MySQL database.

This tool is for modifying data in the database. It executes statements that change data and returns information about affected rows.

Args:
  - sql (string): The SQL statement to execute (INSERT, UPDATE, DELETE)

Returns:
  JSON object with the following structure:
  {
    "affectedRows": number,  // Number of rows affected
    "insertId": number       // ID of newly inserted row (for INSERT only)
  }

Examples:
  - INSERT INTO users (name, email) VALUES ('John Doe', 'john@example.com')
  - UPDATE users SET active = false WHERE last_login < '2024-01-01'
  - DELETE FROM users WHERE id = 123

Error Handling:
  - Returns error message if SQL syntax is invalid
  - Returns error if table or column does not exist
  - Returns error if foreign key constraint is violated
  - Returns error if database connection fails`,
    inputSchema: MySQLExecuteSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async (params: MySQLExecuteInput) => {
    try {
      const result = await mysqlService.execute(params.sql);
      const output = {
        affectedRows: result.affectedRows,
        insertId: result.insertId,
      };

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(output, null, 2),
          },
        ],
        structuredContent: output,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${message}`,
          },
        ],
        isError: true,
      };
    }
  }
);

/**
 * Main entry point
 */
async function main() {
  try {
    // Initialize SSH connection if enabled
    if (sshConfig.enabled) {
      await mysqlService.initSSH();
    }

    // Connect to stdio transport
    const transport = new StdioServerTransport();
    await server.connect(transport);

    const mode = sshConfig.enabled ? 'SSH Tunnel' : 'Direct';
    console.error(`MySQL MCP Server running on stdio (${mode})`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Failed to start server:', message);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  mysqlService.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  mysqlService.close();
  process.exit(0);
});

main();