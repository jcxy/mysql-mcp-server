import mysql from 'mysql2';
import { Client } from 'ssh2';
import type { ConnectConfig } from 'ssh2';
import type { SSHConfig, MySQLConfig, ConnectionState, ExecuteResult } from './types.js';

/**
 * MySQL connection service supporting both direct and SSH tunnel connections
 */
export class MySQLService {
  private sshConfig: SSHConfig;
  private mysqlConfig: MySQLConfig;
  private state: ConnectionState = {
    sshClient: null,
    sshReady: false,
  };

  constructor(sshConfig: SSHConfig, mysqlConfig: MySQLConfig) {
    this.sshConfig = sshConfig;
    this.mysqlConfig = mysqlConfig;
  }

  /**
   * Initialize SSH connection if enabled
   */
  async initSSH(): Promise<boolean> {
    if (!this.sshConfig.enabled) {
      return false;
    }

    return new Promise((resolve, reject) => {
      console.error(`[SSH] Connecting to ${this.sshConfig.host}:${this.sshConfig.port}...`);

      const ssh = new Client();
      this.state.sshClient = ssh;

      ssh.on('ready', () => {
        console.error('[SSH] Connected successfully');
        this.state.sshReady = true;
        resolve(true);
      });

      ssh.on('error', (err) => {
        console.error('[SSH] Connection error:', err.message);
        this.state.sshReady = false;
        reject(new Error(`SSH connection failed: ${err.message}`));
      });

      ssh.on('close', () => {
        console.error('[SSH] Connection closed');
        this.state.sshReady = false;
      });

      const connectOpts: ConnectConfig = {
        host: this.sshConfig.host,
        port: this.sshConfig.port,
        username: this.sshConfig.username,
        readyTimeout: 10000,
      };

      if (this.sshConfig.privateKey) {
        connectOpts.privateKey = this.sshConfig.privateKey;
        if (this.sshConfig.passphrase) {
          connectOpts.passphrase = this.sshConfig.passphrase;
        }
      } else if (this.sshConfig.password) {
        connectOpts.password = this.sshConfig.password;
      }

      ssh.connect(connectOpts);
    });
  }

  /**
   * Execute a SELECT query via SSH tunnel
   */
  private queryViaSSH(sql: string, isExecute: false): Promise<Record<string, unknown>[]>;
  private queryViaSSH(sql: string, isExecute: true): Promise<ExecuteResult>;
  private queryViaSSH(sql: string, isExecute: boolean): Promise<Record<string, unknown>[] | ExecuteResult> {
    return new Promise((resolve, reject) => {
      if (!this.state.sshClient || !this.state.sshReady) {
        return reject(new Error('SSH connection not ready'));
      }

      this.state.sshClient.forwardOut(
        '127.0.0.1',
        0,
        this.sshConfig.remoteHost,
        this.sshConfig.remotePort,
        (err, stream) => {
          if (err) {
            console.error('[SSH] forwardOut error:', err.message);
            return reject(new Error(`SSH tunnel error: ${err.message}`));
          }

          const connection = mysql.createConnection({
            user: this.mysqlConfig.user,
            password: this.mysqlConfig.password,
            database: this.mysqlConfig.database,
            stream: stream,
          });

          connection.on('error', (connErr) => {
            console.error('[MySQL] Connection error:', connErr.message);
            reject(connErr);
          });

          if (isExecute) {
            connection.execute(sql, (execErr, result: mysql.ResultSetHeader) => {
              connection.end();
              if (execErr) {
                reject(execErr);
              } else {
                resolve({ affectedRows: result.affectedRows, insertId: result.insertId });
              }
            });
          } else {
            connection.query(sql, (queryErr, rows: Record<string, unknown>[]) => {
              connection.end();
              if (queryErr) {
                reject(queryErr);
              } else {
                resolve(rows);
              }
            });
          }
        }
      );
    });
  }

  /**
   * Execute a query via direct MySQL connection
   */
  private queryDirect(sql: string, isExecute: false): Promise<Record<string, unknown>[]>;
  private queryDirect(sql: string, isExecute: true): Promise<ExecuteResult>;
  private queryDirect(sql: string, isExecute: boolean): Promise<Record<string, unknown>[] | ExecuteResult> {
    return new Promise((resolve, reject) => {
      const connection = mysql.createConnection({
        host: this.mysqlConfig.host,
        port: this.mysqlConfig.port,
        user: this.mysqlConfig.user,
        password: this.mysqlConfig.password,
        database: this.mysqlConfig.database,
      });

      connection.on('error', (err) => {
        reject(err);
      });

      if (isExecute) {
        connection.execute(sql, (err, result: mysql.ResultSetHeader) => {
          connection.end();
          if (err) {
            reject(err);
          } else {
            resolve({ affectedRows: result.affectedRows, insertId: result.insertId });
          }
        });
      } else {
        connection.query(sql, (err, rows: Record<string, unknown>[]) => {
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

  /**
   * Execute a SELECT query
   */
  async query(sql: string): Promise<Record<string, unknown>[]> {
    if (this.sshConfig.enabled) {
      return this.queryViaSSH(sql, false);
    }
    return this.queryDirect(sql, false);
  }

  /**
   * Execute an INSERT/UPDATE/DELETE statement
   */
  async execute(sql: string): Promise<ExecuteResult> {
    if (this.sshConfig.enabled) {
      return this.queryViaSSH(sql, true);
    }
    return this.queryDirect(sql, true);
  }

  /**
   * Check if SSH tunnel is enabled
   */
  isSSHEnabled(): boolean {
    return this.sshConfig.enabled;
  }

  /**
   * Check if SSH connection is ready
   */
  isSSHReady(): boolean {
    return this.state.sshReady;
  }

  /**
   * Close SSH connection
   */
  close(): void {
    if (this.state.sshClient) {
      this.state.sshClient.end();
      this.state.sshClient = null;
      this.state.sshReady = false;
    }
  }
}