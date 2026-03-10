import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import mysql from 'mysql2/promise';
import { Client } from 'ssh2';
import config from './config.js';

// 数据库配置：优先使用环境变量
const dbConfig = {
  host: process.env.MYSQL_HOST || config.host || 'localhost',
  port: parseInt(process.env.MYSQL_PORT, 10) || config.port || 3306,
  user: process.env.MYSQL_USER || config.user || 'root',
  password: process.env.MYSQL_PASSWORD || config.password || '',
  database: process.env.MYSQL_DATABASE || config.database,
  waitForConnections: true,
  connectionLimit: parseInt(process.env.MYSQL_CONNECTION_LIMIT, 10) || config.connectionLimit || 10,
  queueLimit: config.queueLimit || 0
};

// SSH 配置
const sshConfig = {
  enabled: process.env.SSH_ENABLED === 'true' || config.ssh?.enabled || false,
  host: process.env.SSH_HOST || config.ssh?.host || '',
  port: parseInt(process.env.SSH_PORT, 10) || config.ssh?.port || 22,
  username: process.env.SSH_USERNAME || config.ssh?.username || '',
  password: process.env.SSH_PASSWORD || config.ssh?.password || '',
  privateKey: process.env.SSH_PRIVATE_KEY || config.ssh?.privateKey || '',
  passphrase: process.env.SSH_PASSPHRASE || config.ssh?.passphrase || '',
  // SSH 隧道本地转发配置
  localPort: parseInt(process.env.SSH_LOCAL_PORT, 10) || config.ssh?.localPort || 3307,
  localHost: process.env.SSH_LOCAL_HOST || config.ssh?.localHost || '127.0.0.1',
  remoteHost: process.env.SSH_REMOTE_HOST || config.ssh?.remoteHost || dbConfig.host,
  remotePort: parseInt(process.env.SSH_REMOTE_PORT, 10) || config.ssh?.remotePort || dbConfig.port
};

let pool = null;
let sshClient = null;

// 创建 SSH 隧道
function createSSHTunnel() {
  return new Promise((resolve, reject) => {
    if (!sshConfig.enabled) {
      return resolve(null);
    }

    console.error(`[SSH] Connecting to ${sshConfig.host}:${sshConfig.port}...`);

    const ssh = new Client();
    sshClient = ssh;

    ssh.on('ready', () => {
      console.error('[SSH] Connected, creating tunnel...');

      ssh.forwardOut(
        sshConfig.localHost,
        sshConfig.localPort,
        sshConfig.remoteHost,
        sshConfig.remotePort,
        (err, stream) => {
          if (err) {
            console.error('[SSH] Forward error:', err.message);
            return reject(err);
          }

          // 测试连接是否成功
          stream.on('error', (e) => {
            console.error('[SSH] Stream error:', e.message);
          });

          console.error(`[SSH] Tunnel created: ${sshConfig.localHost}:${sshConfig.localPort} -> ${sshConfig.remoteHost}:${sshConfig.remotePort}`);
          resolve(stream);
        }
      );
    });

    ssh.on('error', (err) => {
      console.error('[SSH] Connection error:', err.message);
      reject(err);
    });

    ssh.on('keyboard-interactive', (name, instructions, lang, prompts, finish) => {
      console.error('[SSH] Keyboard interactive auth not supported');
      finish([]);
    });

    ssh.on('greeting', (greeting) => {
      console.error('[SSH] Greeting:', greeting);
    });

    ssh.on('close', () => {
      console.error('[SSH] Connection closed');
    });

    // 构建连接选项
    const connectOpts = {
      host: sshConfig.host,
      port: sshConfig.port,
      username: sshConfig.username,
      readyTimeout: 10000
    };

    // 优先使用私钥认证
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

// 创建 MySQL 连接池
async function createPool() {
  if (sshConfig.enabled) {
    // 使用 SSH 隧道时，连接到本地转发的端口
    const poolConfig = {
      ...dbConfig,
      host: sshConfig.localHost,
      port: sshConfig.localPort,
      // SSH 模式下不指定 database，通过后续连接指定
      database: undefined
    };
    pool = mysql.createPool(poolConfig);
  } else {
    // 直接连接
    const poolConfig = { ...dbConfig };
    Object.keys(poolConfig).forEach(key => poolConfig[key] === undefined && delete poolConfig[key]);
    pool = mysql.createPool(poolConfig);
  }
}

const server = new Server(
  {
    name: 'mysql-server',
    version: '1.0.1',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// 注册工具：查询 MySQL
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
    if (name === 'mysql_query') {
      const [rows] = await pool.query(args.sql);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(rows, null, 2),
          },
        ],
      };
    } else if (name === 'mysql_execute') {
      const [result] = await pool.execute(args.sql);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ affectedRows: result.affectedRows, insertId: result.insertId }, null, 2),
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
    // 如果启用 SSH，先建立隧道
    if (sshConfig.enabled) {
      await createSSHTunnel();
    }

    // 创建 MySQL 连接池
    await createPool();

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