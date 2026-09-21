// 数据库连接配置模板
// 方式1: 修改此文件重命名为 config.js
// 方式2: 通过环境变量配置 (推荐，在 MCP 配置中设置)

// ==================== MySQL 配置 ====================
// 环境变量: MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE
export default {
  host: 'localhost',
  port: 3306,
  user: 'root',
  password: 'your_password',
  database: 'your_database', // 可选

  // ==================== 安全配置 ====================
  readOnly: false,   // 只读模式：启用后 mysql_execute 将被禁用
  maxRows: 1000,     // 查询结果最大行数，超出将截断

  // ==================== SSH 隧道配置 (可选) ====================
  // 环境变量: SSH_ENABLED, SSH_HOST, SSH_PORT, SSH_USERNAME, SSH_PASSWORD, SSH_PRIVATE_KEY
  ssh: {
    enabled: false, // 设为 true 启用 SSH 隧道
    host: 'ssh.example.com',     // SSH 服务器地址
    port: 22,                    // SSH 端口
    username: 'your_user',       // SSH 用户名
    password: '',                // SSH 密码 (与私钥二选一)
    privateKey: '',              // SSH 私钥内容 (与密码二选一)
    passphrase: '',              // 私钥 passphrase (可选)

    // 隧道转发配置
    remoteHost: 'localhost',     // MySQL 在远程服务器上的地址
    remotePort: 3306             // MySQL 在远程服务器上的端口
  }
};
