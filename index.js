/**
 * MySQL MCP Server — 组装入口
 * 
 * 职责仅限：加载配置、选定数据库后端、装配 MCP 服务器、启动 stdio 传输。
 * 各功能模块：
 *   - lib/config.js          配置解析（纯函数）
 *   - lib/backend/*          数据库后端适配器（连接池 / SSH 隧道）
 *   - lib/tools.js           工具定义与分派（咽喉点：白名单、只读、截断）
 *   - lib/validation.js      语句白名单、MAX_ROWS 解析、结果截断
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { readFileSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';

import config from './config.js';
import { loadConfig } from './lib/config.js';
import { createPoolBackend } from './lib/backend/pool-backend.js';
import { createSSHBackend } from './lib/backend/ssh-backend.js';
import { toolDefinitions, handleToolCall } from './lib/tools.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const pkg = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf-8'));

// 配置解析（环境变量 > config.js > 默认值）
const cfg = loadConfig(process.env, config);

// 启动时一次性选定数据库后端（部署拓扑在这里固化，运行期不再感知模式）
const db = cfg.ssh.enabled
  ? createSSHBackend(cfg.ssh, cfg.db)
  : createPoolBackend(cfg.db);

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
  return { tools: toolDefinitions };
});

server.setRequestHandler(CallToolRequestSchema, (request) => {
  return handleToolCall(request.params.name, request.params.arguments, {
    db,
    readOnly: cfg.readOnly,
    maxRows: cfg.maxRows,
  });
});

async function main() {
  try {
    await db.init();

    const transport = new StdioServerTransport();
    await server.connect(transport);

    const mode = cfg.ssh.enabled ? 'SSH Tunnel' : 'Direct (pool)';
    const roFlag = cfg.readOnly ? ' [只读模式]' : '';
    console.error(`MySQL MCP Server v${pkg.version} running on stdio (${mode})${roFlag}, MAX_ROWS=${cfg.maxRows}`);
  } catch (error) {
    console.error('Failed to start server:', error.message);
    process.exit(1);
  }
}

// 入口守卫：仅直接执行本文件时启动服务器，测试进程可安全导入本模块
const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  main();
}
