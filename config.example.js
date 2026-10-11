// 数据库连接配置模板
// 方式1: 修改此文件重命名为 config.js
// 方式2: 单环境可通过环境变量配置（在 MCP 配置中设置）
//
// 凭据分离（推荐）：本文件只放环境结构与权限策略（可提交到仓库），
// 密码等秘密放在用户主目录凭据文件 ~/.mysql-mcp/credentials.json（不进仓库）：
//
//   {
//     "dev":  { "password": "dev_password" },
//     "prod": { "password": "readonly_password" }
//   }
//
// 路径可用环境变量 MYSQL_MCP_CREDENTIALS_FILE 覆盖。

// ==================== 多环境配置（推荐）====================
// 环境名仅允许字母、数字、下划线；两个及以上环境必须显式声明 defaultEnvironment
export default {
  defaultEnvironment: 'dev', // 未传 environment 参数时落到此环境

  environments: {
    // dev：与你的账号权限一致，AI 可自由执行 DDL/DML
    dev: {
      host: 'localhost',
      port: 3306,
      user: 'dev_user',
      database: 'devdb',   // 可选

      // 安全策略（per-env）
      readOnly: false,     // false: mysql_execute 可用
      maxRows: 1000,       // 查询结果最大行数

      // SSH 隧道（可选，结构与单环境一致；秘密同样来自凭据文件）
      // ssh: {
      //   enabled: false,
      //   host: 'ssh.example.com',
      //   port: 22,
      //   username: 'your_user',
      //   remoteHost: 'localhost', // 隧道目标 MySQL 地址，默认回退本环境 host
      //   remotePort: 3306,
      // },
    },

    // prod：只读环境。最佳实践是配合数据库侧最小权限只读账号（GRANT SELECT, SHOW VIEW），
    // readOnly: true 是 MCP 侧体验层（禁用 mysql_execute / mysql_begin），不是安全边界
    prod: {
      host: 'prod-db.example.com',
      port: 3306,
      user: 'ai_readonly',
      database: 'proddb',

      readOnly: true,
      maxRows: 100,
    },
  },
};

// ==================== 单环境配置（旧格式，完全兼容）====================
// 不写 environments 键时自动映射为名为 default 的单一环境：
//
// export default {
//   host: 'localhost',
//   port: 3306,
//   user: 'root',
//   password: 'your_password',   // 旧格式仍支持此处密码；推荐迁移到凭据文件
//   database: 'your_database',
//   readOnly: false,
//   maxRows: 1000,
//   ssh: { enabled: false, /* ... */ },
// };
