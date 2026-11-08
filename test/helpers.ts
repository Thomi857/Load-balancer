import type { QueryResultRow } from 'pg';
import { createDatabasePool } from '../src/db/pool.js';
import { runMigrations } from '../src/db/migrate.js';
import type { DatabasePool, DatabaseResult } from '../src/db/pool.js';
import type { AppConfig, DatabaseConfig } from '../src/config/env.js';

export const testDatabaseConfig: DatabaseConfig = {
  host: '127.0.0.1',
  port: 5432,
  database: 'backend_test',
  user: 'test_user',
  password: 'test_password',
  poolMax: 2,
  connectionTimeoutMs: 1000,
  idleTimeoutMs: 1000,
  queryTimeoutMs: 1000,
};

export const testAppConfig: AppConfig = {
  host: '127.0.0.1',
  port: 3000,
  logLevel: 'silent',
  instanceId: 'test-instance',
  database: testDatabaseConfig,
};

export function createFakeDatabase(
  implementation: (text: string, values?: unknown[]) => Promise<DatabaseResult>,
): DatabasePool {
  return {
    async query<T extends QueryResultRow = QueryResultRow>(
      text: string,
      values?: unknown[],
    ): Promise<DatabaseResult<T>> {
      const result = await implementation(text, values);
      return { rows: result.rows as T[], rowCount: result.rowCount };
    },
    async end(): Promise<void> {},
  };
}

export function getTestDatabaseConfig(env: NodeJS.ProcessEnv = process.env): DatabaseConfig | null {
  const { TEST_DB_HOST, TEST_DB_PORT, TEST_DB_NAME, TEST_DB_USER, TEST_DB_PASSWORD } = env;
  if (
    TEST_DB_HOST === undefined ||
    TEST_DB_PORT === undefined ||
    TEST_DB_NAME === undefined ||
    TEST_DB_USER === undefined ||
    TEST_DB_PASSWORD === undefined
  ) {
    return null;
  }
  if (TEST_DB_NAME !== 'backend_test') {
    throw new Error('Integration tests require TEST_DB_NAME=backend_test');
  }

  const port = Number(TEST_DB_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('TEST_DB_PORT must be an integer between 1 and 65535');
  }

  return {
    host: TEST_DB_HOST,
    port,
    database: TEST_DB_NAME,
    user: TEST_DB_USER,
    password: TEST_DB_PASSWORD,
    poolMax: 5,
    connectionTimeoutMs: 1500,
    idleTimeoutMs: 1000,
    queryTimeoutMs: 5000,
  };
}

export async function prepareTestDatabase(): Promise<void> {
  const config = getTestDatabaseConfig();
  if (!config) {
    throw new Error('Set TEST_DB_HOST, TEST_DB_PORT, TEST_DB_NAME=backend_test, TEST_DB_USER, and TEST_DB_PASSWORD');
  }

  const pool = createDatabasePool(config);
  try {
    await runMigrations(pool);
  } finally {
    await pool.end();
  }
}

export function testDatabaseEnvironment(config: DatabaseConfig): NodeJS.ProcessEnv {
  return {
    DB_HOST: config.host,
    DB_PORT: String(config.port),
    DB_NAME: config.database,
    DB_USER: config.user,
    DB_PASSWORD: config.password,
    DB_POOL_MAX: String(config.poolMax),
    DB_CONNECTION_TIMEOUT_MS: String(config.connectionTimeoutMs),
    DB_IDLE_TIMEOUT_MS: String(config.idleTimeoutMs),
    DB_QUERY_TIMEOUT_MS: String(config.queryTimeoutMs),
  };
}
