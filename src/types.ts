/**
 * Type definitions for MySQL MCP Server
 */

import type { Client } from 'ssh2';

// SSH Configuration
export interface SSHConfig {
  enabled: boolean;
  host: string;
  port: number;
  username: string;
  password: string;
  privateKey: string;
  passphrase: string;
  remoteHost: string;
  remotePort: number;
}

// MySQL Configuration
export interface MySQLConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database?: string;
}

// Query result types
export interface QueryResult {
  rows: Record<string, unknown>[];
  fields?: unknown[];
}

export interface ExecuteResult {
  affectedRows: number;
  insertId: number;
}

// Connection state
export interface ConnectionState {
  sshClient: Client | null;
  sshReady: boolean;
}

// Tool output types
export interface QueryOutput {
  rows: Record<string, unknown>[];
  rowCount: number;
}

export interface ExecuteOutput {
  affectedRows: number;
  insertId: number;
}