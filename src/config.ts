import type { SSHConfig, MySQLConfig } from './types.js';

/**
 * Get SSH configuration from environment variables
 */
export function getSSHConfig(): SSHConfig {
  return {
    enabled: process.env.SSH_ENABLED === 'true',
    host: process.env.SSH_HOST || '',
    port: parseInt(process.env.SSH_PORT || '22', 10),
    username: process.env.SSH_USERNAME || '',
    password: process.env.SSH_PASSWORD || '',
    privateKey: process.env.SSH_PRIVATE_KEY || '',
    passphrase: process.env.SSH_PASSPHRASE || '',
    remoteHost: process.env.SSH_REMOTE_HOST || process.env.MYSQL_HOST || 'localhost',
    remotePort: parseInt(process.env.SSH_REMOTE_PORT || process.env.MYSQL_PORT || '3306', 10),
  };
}

/**
 * Get MySQL configuration from environment variables
 */
export function getMySQLConfig(): MySQLConfig {
  return {
    host: process.env.MYSQL_HOST || 'localhost',
    port: parseInt(process.env.MYSQL_PORT || '3306', 10),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE,
  };
}