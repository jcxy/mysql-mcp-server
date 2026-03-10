import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import mysql from 'mysql2';
import { Client } from 'ssh2';
import config from './config.js';

// SSH 配置
const sshConfig = {
  enabled: process.env.SSH_ENABLED === 'true' || config.ssh?.enabled || false,
  host: process.env.SSH_HOST || config.ssh?.host || '',
  port: parseInt(process.env.SSH_PORT, 10) || config.ssh?.port || 22,
  username: process.env.SSH_USERNAME || config.ssh?.username || '',
  password: process.env.SSH_PASSWORD || config.ssh?.password || '',
  privateKey: process.env.SSH_PRIVATE_KEY || config.ssh?.privateKey || '',
  passphrase: process.env.SSH_PASSPHRASE || config.ssh?.passphrase || '',
  remoteHost: process.env.SSH_REMOTE_HOST || process.env.MYSQL_HOST || config.ssh?.remoteHost || 'localhost',
  remotePort: parseInt(process.env.SSH_REMOTE_PORT, 10) || parseInt(process.env.MYSQL_PORT, 10) || config.ssh?.remotePort || 3306
};

// MySQL 配置
const dbConfig = {
  host: process.env.MYSQL_HOST || config.host || 'localhost',
  port: parseInt(process.env.MYSQL_PORT, 10) || config.port || 3306,
  user: process.env.MYSQL_USER || config.user || 'root',
  password: process.env.MYSQL_PASSWORD || config.password || '',
  database: process.env.MYSQL_DATABASE || config.database,
};

let sshClient = null;
let sshReady = false;

// 初始化 SSH 连接
function initSSH() {
  return new Promise((resolve, reject) => {
    if (!sshConfig.enabled) {
      return resolve(null);
    }

    console.error(`[SSH] Connecting to ${sshConfig.host}:${sshConfig.port}...`);

    const ssh = new Client();
    sshClient = ssh;

    ssh.on('ready', () => {
      console.error('[SSH] Connected successfully');
      sshReady = true;
      resolve(true);
    });

    ssh.on('error', (err) => {
      console.error('[SSH] Connection error:', err.message);
      sshReady = false;
      reject(err);
    });

    ssh.on('close', () => {
      console.error('[SSH] Connection closed');
      sshReady = false;
    });

    const connectOpts = {
      host: sshConfig.host,
      port: sshConfig.port,
      username: sshConfig.username,
      readyTimeout: 10000
    };

    if (sshConfig.privateKey) {
      connectOpts.privateKey = sshConfig.privateKey;
      if (sshConfig.passphrase) {
        connectOpts.passphrase = sshConfig.passphrase;
      }
    } else if (sshConfig.password) {
      connectOpts.password = sshConfig.password;
    }

    ssh.connect(connectOpts);
  });
}

// 通过 SSH 隧道执行 MySQL 查询
function queryViaSSH(sql, isExecute = false) {
  return new Promise((resolve, reject) => {
    if (!sshClient || !sshReady) {
      return reject(new Error('SSH connection not ready'));
    }

    sshClient.forwardOut(
      '127.0.0.1',
      0,
      sshConfig.remoteHost,
      sshConfig.remotePort,
      (err, stream) => {
        if (err) {
          console.error('[SSH] forwardOut error:', err.message);
          return reject(new Error(`SSH tunnel error: ${err.message}`));
        }

        // 使用回调风格的 mysql2 连接
        const connection = mysql.createConnection({
          user: dbConfig.user,
          password: dbConfig.password,
          database: dbConfig.database,
          stream: stream
        });

        connection.on('error', (err) => {
          console.error('[MySQL] Connection error:', err.message);
          reject(err);
        });

        if (isExecute) {
          connection.execute(sql, (err, result) => {
            connection.end();
            if (err) {
              reject(err);
            } else {
              resolve({ affectedRows: result.affectedRows, insertId: result.insertId });
            }
          });
        } else {
          connection.query(sql, (err, rows) => {
            connection.end();
            if (err) {
              reject(err);
            } else {
              resolve(rows);
            }
          });
        }
      }
    );
  });
}

// 直接连接 MySQL 查询
function queryDirect(sql, isExecute = false) {
  return new Promise((resolve, reject) => {
    const connection = mysql.createConnection({
      host: dbConfig.host,
      port: dbConfig.port,
      user: dbConfig.user,
      password: dbConfig.password,
      database: dbConfig.database,
    });

    connection.on('error', (err) => {
      reject(err);
    });

    if (isExecute) {
      connection.execute(sql, (err, result) => {
        connection.end();
        if (err) {
          reject(err);
        } else {
          resolve({ affectedRows: result.affectedRows, insertId: result.insertId });
        }
      });
    } else {
      connection.query(sql, (err, rows) => {
        connection.end();
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    }
  });
}

const server = new Server(
  {
    name: 'mysql-server',
    version: '1.0.3',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'mysql_query',
        description: '执行 MySQL 查询，返回查询结果',
        inputSchema: {
          type: 'object',
          properties: {
            sql: {
              type: 'string',
              description: '要执行的 SQL 查询语句',
            },
          },
          required: ['sql'],
        },
      },
      {
        name: 'mysql_execute',
        description: '执行 MySQL 更新/删除/插入语句，返回受影响行数',
        inputSchema: {
          type: 'object',
          properties: {
            sql: {
              type: 'string',
              description: '要执行的 SQL 语句（UPDATE/DELETE/INSERT）',
            },
          },
          required: ['sql'],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result;
    if (name === 'mysql_query') {
      if (sshConfig.enabled) {
        result = await queryViaSSH(args.sql, false);
      } else {
        result = await queryDirect(args.sql, false);
      }
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } else if (name === 'mysql_execute') {
      if (sshConfig.enabled) {
        result = await queryViaSSH(args.sql, true);
      } else {
        result = await queryDirect(args.sql, true);
      }
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } else {
      throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error.message}`,
        },
      ],
      isError: true,
    };
  }
});

async function main() {
  try {
    if (sshConfig.enabled) {
      await initSSH();
    }

    const transport = new StdioServerTransport();
    await server.connect(transport);

    const mode = sshConfig.enabled ? 'SSH Tunnel' : 'Direct';
    console.error(`MySQL MCP Server running on stdio (${mode})`);
  } catch (error) {
    console.error('Failed to start server:', error.message);
    process.exit(1);
  }
}

main();