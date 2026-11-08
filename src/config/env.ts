import { randomUUID } from 'node:crypto';

const logLevels = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

export type LogLevel = (typeof logLevels)[number];

export interface AppConfig {
  host: string;
  port: number;
  logLevel: LogLevel;
  instanceId: string;
  database: DatabaseConfig;
}

export interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  poolMax: number;
  connectionTimeoutMs: number;
  idleTimeoutMs: number;
  queryTimeoutMs: number;
}

function readInteger(
  name: string,
  value: string | undefined,
  defaultValue: number,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined) {
    return defaultValue;
  }

  const port = Number(value);
  if (!Number.isInteger(port) || port < minimum || port > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return port;
}

function requiredValue(name: string, value: string | undefined): string {
  if (value === undefined || value.trim() === '') {
    throw new Error(`${name} is required`);
  }
  return value;
}

function readLogLevel(value: string | undefined): LogLevel {
  if (value === undefined) {
    return 'info';
  }

  const level = logLevels.find((candidate) => candidate === value);
  if (level !== undefined) {
    return level;
  }
  throw new Error(`LOG_LEVEL must be one of: ${logLevels.join(', ')}`);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    host: env.HOST || '0.0.0.0',
    port: readInteger('PORT', env.PORT, 3000, 1, 65535),
    logLevel: readLogLevel(env.LOG_LEVEL),
    instanceId: env.INSTANCE_ID || randomUUID(),
    database: {
      host: requiredValue('DB_HOST', env.DB_HOST),
      port: readInteger('DB_PORT', env.DB_PORT, 5432, 1, 65535),
      database: requiredValue('DB_NAME', env.DB_NAME),
      user: requiredValue('DB_USER', env.DB_USER),
      password: requiredValue('DB_PASSWORD', env.DB_PASSWORD),
      poolMax: readInteger('DB_POOL_MAX', env.DB_POOL_MAX, 10, 1, 100),
      connectionTimeoutMs: readInteger(
        'DB_CONNECTION_TIMEOUT_MS',
        env.DB_CONNECTION_TIMEOUT_MS,
        5000,
        1,
        60000,
      ),
      idleTimeoutMs: readInteger('DB_IDLE_TIMEOUT_MS', env.DB_IDLE_TIMEOUT_MS, 30000, 0, 600000),
      queryTimeoutMs: readInteger(
        'DB_QUERY_TIMEOUT_MS',
        env.DB_QUERY_TIMEOUT_MS,
        10000,
        1,
        600000,
      ),
    },
  };
}
