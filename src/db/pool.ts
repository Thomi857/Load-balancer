import { Pool, type QueryResultRow } from 'pg';
import type { DatabaseConfig } from '../config/env.js';

export interface DatabaseResult<Row extends QueryResultRow = QueryResultRow> {
  rows: Row[];
  rowCount: number | null;
}

export interface DatabasePool {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<DatabaseResult<T>>;
  end(): Promise<void>;
}

export function createDatabasePool(config: DatabaseConfig): Pool {
  return new Pool({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    max: config.poolMax,
    connectionTimeoutMillis: config.connectionTimeoutMs,
    idleTimeoutMillis: config.idleTimeoutMs,
    query_timeout: config.queryTimeoutMs,
    statement_timeout: config.queryTimeoutMs,
    application_name: 'load-balanced-backend',
  });
}
