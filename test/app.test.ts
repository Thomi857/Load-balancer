import assert from 'node:assert/strict';
import { hostname } from 'node:os';
import test from 'node:test';
import { buildApp } from '../src/app.js';
import { loadConfig, type AppConfig } from '../src/config/env.js';
import { createFakeDatabase, testAppConfig } from './helpers.js';

const config: AppConfig = testAppConfig;

test('health and readiness endpoints report their status', async (t) => {
  const app = buildApp(config, {
    database: createFakeDatabase(async () => ({ rows: [], rowCount: 1 })),
  });
  t.after(() => app.close());

  const health = await app.inject({ method: 'GET', url: '/health' });
  assert.equal(health.statusCode, 200);
  assert.deepEqual(health.json(), { status: 'ok' });

  const ready = await app.inject({ method: 'GET', url: '/ready' });
  assert.equal(ready.statusCode, 200);
  assert.deepEqual(ready.json(), { status: 'ready' });
});

test('instance endpoint returns process identity and an ISO timestamp', async (t) => {
  const app = buildApp(config, {
    database: createFakeDatabase(async () => ({ rows: [], rowCount: 1 })),
  });
  t.after(() => app.close());

  const response = await app.inject({ method: 'GET', url: '/api/instance' });
  const body = response.json<{
    instanceId: string;
    hostname: string;
    timestamp: string;
  }>();
  const secondResponse = await app.inject({ method: 'GET', url: '/api/instance' });
  const secondBody = secondResponse.json<{ instanceId: string }>();

  assert.equal(response.statusCode, 200);
  assert.equal(body.instanceId, config.instanceId);
  assert.equal(body.instanceId, config.instanceId);
  assert.equal(secondBody.instanceId, body.instanceId);
  assert.equal(body.hostname, hostname());
  assert.equal(new Date(body.timestamp).toISOString(), body.timestamp);
});

test('environment configuration applies defaults and rejects invalid values', () => {
  const defaultConfig = loadConfig({
    DB_HOST: 'localhost',
    DB_NAME: 'backend',
    DB_USER: 'user',
    DB_PASSWORD: 'password',
  });
  assert.equal(defaultConfig.host, '0.0.0.0');
  assert.equal(defaultConfig.port, 3000);
  assert.equal(defaultConfig.logLevel, 'info');
  assert.match(defaultConfig.instanceId, /^[0-9a-f-]{36}$/);
  assert.equal(defaultConfig.database.poolMax, 10);
  assert.equal(defaultConfig.database.connectionTimeoutMs, 5000);

  const overrideConfig = loadConfig({
    PORT: '4321',
    LOG_LEVEL: 'debug',
    INSTANCE_ID: 'node-a',
    DB_HOST: 'localhost',
    DB_NAME: 'backend',
    DB_USER: 'user',
    DB_PASSWORD: 'password',
    DB_PORT: '5433',
    DB_POOL_MAX: '4',
  });
  assert.equal(overrideConfig.port, 4321);
  assert.equal(overrideConfig.logLevel, 'debug');
  assert.equal(overrideConfig.instanceId, 'node-a');
  assert.equal(overrideConfig.database.port, 5433);
  assert.equal(overrideConfig.database.poolMax, 4);
  assert.throws(() => loadConfig({ PORT: '0' }), /PORT must be an integer/);
  assert.throws(() => loadConfig({ PORT: '65536' }), /PORT must be an integer/);
  assert.throws(() => loadConfig({ PORT: '3000.5' }), /PORT must be an integer/);
  assert.throws(() => loadConfig({ LOG_LEVEL: 'verbose' }), /LOG_LEVEL must be one of/);
  assert.throws(() => loadConfig({}), /DB_HOST is required/);
  assert.throws(
    () =>
      loadConfig({
        DB_HOST: 'localhost',
        DB_NAME: 'backend',
        DB_USER: 'user',
        DB_PASSWORD: 'password',
        DB_POOL_MAX: '0',
      }),
    /DB_POOL_MAX must be an integer/,
  );
});

test('error responses and logs do not expose error details or query secrets', async (t) => {
  let logs = '';
  const app = buildApp(config, {
    database: createFakeDatabase(async () => ({ rows: [], rowCount: 1 })),
    loggerStream: {
      write: (message) => {
        logs += message;
      },
    },
  });
  app.get('/failure', async () => {
    throw new Error('internal-secret-value');
  });
  t.after(() => app.close());

  const response = await app.inject({
    method: 'GET',
    url: '/failure?access_token=query-secret-value',
    headers: {
      authorization: 'Bearer header-secret-value',
      cookie: 'session=cookie-secret-value',
    },
  });
  assert.equal(response.statusCode, 500);
  assert.deepEqual(response.json(), { error: 'Internal Server Error' });
  assert.doesNotMatch(
    `${response.body}\n${logs}`,
    /internal-secret-value|query-secret-value|header-secret-value|cookie-secret-value/,
  );
});
