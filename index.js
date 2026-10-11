#!/usr/bin/env node
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
import { readFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';

import { loadConfig } from './lib/config.js';
import { createPoolBackend } from './lib/backend/pool-backend.js';
import { createSSHBackend } from './lib/backend/ssh-backend.js';
import { buildToolDefinitions, handleToolCall } from './lib/tools.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const pkg = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf-8'));

// 配置文件加载薄层（接缝外唯一真实 I/O）：默认用户主目录约定路径，MYSQL_MCP_CONFIG_FILE 可覆盖
// 配置文件为可选：不存在时返回空对象（仅用环境变量），解析失败告警后同样继续
function loadFileConfig() {
  const configPath = process.env.MYSQL_MCP_CONFIG_FILE
    || join(homedir(), '.mysql-mcp', 'config.json');
  if (!existsSync(configPath)) {
    return {};
  }
  try {
    return JSON.parse(readFileSync(configPath, 'utf-8'));
  } catch (error) {
    console.error(`[WARN] 加载配置文件失败 (${configPath}): ${error.message}，将继续以无文件配置模式启动`);
    return {};
  }
}

// 配置解析（新格式：结构、策略与秘密均来自 config.json；旧格式：环境变量 > config.json > 默认值）
const cfg = loadConfig(process.env, loadFileConfig());

// 启动期结构校验：配置不合法直接拒启（连接在 T3 改为惰性建立）
if (cfg.errors.length > 0) {
  console.error('配置校验失败，拒绝启动:');
  for (const message of cfg.errors) {
    console.error(`  - ${message}`);
  }
  process.exit(1);
}

/**
 * 惰性 backend 包装：首次调用时才建池/开隧道，启动期零连接
 * - init 成功后实例固化；失败则清除记忆化，下次调用可重试
 * - 所有错误标注来源环境（pool 的连接失败发生在逐查询而非 init，也需标注）
 * - 失败仅影响该环境的调用（handleToolCall 逐环境隔离）
 */
function createLazyBackend(name, factory) {
  let backend = null;
  let initPromise = null;

  async function ensure() {
    if (backend) {
      return backend;
    }
    if (!initPromise) {
      const candidate = factory();
      initPromise = (async () => {
        await candidate.init();
        return candidate;
      })()
        .then((ready) => {
          backend = ready;
          console.error(`[env] ${name} 连接已建立`);
          return ready;
        })
        .catch((error) => {
          initPromise = null; // 允许下次调用重试
          // 丢弃失败候选前释放资源（SSH 实例否则会常驻指数退避重连循环）
          try {
            candidate.close?.();
          } catch {}
          throw tagError(error);
        });
    }
    return initPromise;
  }

  function tagError(error) {
    if (error.envTagged) {
      return error;
    }
    const tagged = new Error(`环境 "${name}": ${error.message}`, { cause: error });
    tagged.envTagged = true;
    return tagged;
  }

  async function invoke(method, ...args) {
    try {
      const ready = await ensure();
      return await ready[method](...args);
    } catch (error) {
      throw tagError(error);
    }
  }

  return {
    query: (sql) => invoke('query', sql),
    execute: (sql) => invoke('execute', sql),
    begin: () => invoke('begin'),
    commit: () => invoke('commit'),
    rollback: () => invoke('rollback'),
  };
}

// 逐环境惰性 backend（部署拓扑在这里固化，连接延迟到首次调用）
const environments = {};
for (const [name, entry] of Object.entries(cfg.environments)) {
  environments[name] = {
    db: createLazyBackend(name, () =>
      entry.ssh.enabled ? createSSHBackend(entry.ssh, entry.db) : createPoolBackend(entry.db)
    ),
    readOnly: entry.readOnly,
    maxRows: entry.maxRows,
  };
}

const environmentRegistry = {
  environments,
  defaultEnvironment: cfg.defaultEnvironment,
};

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
    tools: buildToolDefinitions({
      environmentNames: Object.keys(environmentRegistry.environments),
      defaultEnvironment: environmentRegistry.defaultEnvironment,
    }),
  };
});

server.setRequestHandler(CallToolRequestSchema, (request) => {
  return handleToolCall(request.params.name, request.params.arguments, environmentRegistry);
});

async function main() {
  try {
    // 启动期只做结构校验，不建立任何连接（惰性建连：环境首次被调用时才建池/开隧道）
    const transport = new StdioServerTransport();
    await server.connect(transport);

    const envNames = Object.keys(environments);
    const defaultName = environmentRegistry.defaultEnvironment;
    const roEnvs = envNames.filter((n) => environments[n].readOnly);
    const roFlag = roEnvs.length > 0 ? ` [只读环境: ${roEnvs.join(', ')}]` : '';
    console.error(`MySQL MCP Server v${pkg.version} running on stdio, 环境: ${envNames.join(', ')}（默认: ${defaultName}）${roFlag}，连接将按需建立`);
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
