import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import mysql from 'mysql2';
import { Client } from 'ssh2';
import config from './config.js';
import { validateQuery, parseMaxRows, truncateResult } from './lib/validation.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

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

// 读取版本号
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const pkg = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf-8'));

// 只读模式配置
const readOnly = process.env.READ_ONLY === 'true' || config.readOnly === true || false;

// 结果行数上限
const maxRows = parseMaxRows(
  process.env.MAX_ROWS || config.maxRows,
  1000
);

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
let reconnectAttempts = 0;
let reconnectTimer = null;
const MAX_RECONNECT_DELAY = 30000; // 最大重连间隔 30 秒

// 获取 SSH 连接参数
function getSSHConnectOpts() {
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

  return connectOpts;
}

// 计算重连延迟（指数退避）
function getReconnectDelay() {
  const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), MAX_RECONNECT_DELAY);
  return delay;
}

// 尝试重连 SSH
function reconnectSSH() {
  if (reconnectTimer || !sshConfig.enabled) return;
  
  const delay = getReconnectDelay();
  console.error(`[SSH] Reconnecting in ${delay}ms (attempt ${reconnectAttempts + 1})...`);
  
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    reconnectAttempts++;
    
    const ssh = new Client();
    sshClient = ssh;
    
    ssh.on('ready', () => {
      console.error('[SSH] Reconnected successfully');
      sshReady = true;
      reconnectAttempts = 0; // 重置重连计数
    });
    
    ssh.on('error', (err) => {
      console.error('[SSH] Reconnection error:', err.message);
      sshReady = false;
      // 继续尝试重连
      reconnectSSH();
    });
    
    ssh.on('close', () => {
      console.error('[SSH] Connection closed');
      sshReady = false;
      // 连接关闭后尝试重连
      reconnectSSH();
    });
    
    ssh.connect(getSSHConnectOpts());
  }, delay);
}

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
      reconnectAttempts = 0;
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
      // 连接关闭后尝试重连
      reconnectSSH();
    });

    ssh.connect(getSSHConnectOpts());
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
    version: pkg.version,
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
      {
        name: 'mysql_list_tables',
        description: '列出当前数据库中的所有表',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'mysql_describe_table',
        description: '查看指定表的结构（列名、类型、是否可空等）',
        inputSchema: {
          type: 'object',
          properties: {
            table: {
              type: 'string',
              description: '要查看结构的表名',
            },
          },
          required: ['table'],
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
      // 语句白名单校验
      const validation = validateQuery(args.sql);
      if (!validation.allowed) {
        return {
          content: [{ type: 'text', text: validation.reason }],
          isError: true,
        };
      }

      if (sshConfig.enabled) {
        result = await queryViaSSH(args.sql, false);
      } else {
        result = await queryDirect(args.sql, false);
      }

      // 结果截断
      const truncated = truncateResult(result, maxRows);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(truncated, null, 2),
          },
        ],
      };
    } else if (name === 'mysql_execute') {
      // 只读模式检查
      if (readOnly) {
        return {
          content: [{
            type: 'text',
            text: '当前为只读模式（READ_ONLY=true），变更语句已被禁用。如需执行变更，请关闭只读模式后重试。'
          }],
          isError: true,
        };
      }

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
    } else if (name === 'mysql_list_tables') {
      // 列出当前数据库的所有表
      const sql = 'SHOW TABLES';
      if (sshConfig.enabled) {
        result = await queryViaSSH(sql, false);
      } else {
        result = await queryDirect(sql, false);
      }
      // 提取表名列表
      const tables = result.map(row => Object.values(row)[0]);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ tables, count: tables.length }, null, 2),
          },
        ],
      };
    } else if (name === 'mysql_describe_table') {
      // 查看表结构
      const tableName = args.table;
      // 验证表名（防止 SQL 注入）- 使用白名单
      if (!tableName || typeof tableName !== 'string') {
        return {
          content: [{ type: 'text', text: '表名不能为空' }],
          isError: true,
        };
      }
      // 仅允许字母、数字、下划线（合法 MySQL 标识符）
      if (!/^[a-zA-Z0-9_]+$/.test(tableName)) {
        return {
          content: [{ type: 'text', text: '表名包含非法字符（仅允许字母、数字和下划线）' }],
          isError: true,
        };
      }
      const sql = `DESCRIBE \`${tableName}\``;
      if (sshConfig.enabled) {
        result = await queryViaSSH(sql, false);
      } else {
        result = await queryDirect(sql, false);
      }
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ table: tableName, columns: result }, null, 2),
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
    const roFlag = readOnly ? ' [只读模式]' : '';
    console.error(`MySQL MCP Server v${pkg.version} running on stdio (${mode})${roFlag}, MAX_ROWS=${maxRows}`);
  } catch (error) {
    console.error('Failed to start server:', error.message);
    process.exit(1);
  }
}

main();