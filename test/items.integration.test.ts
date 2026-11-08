import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApp } from '../src/app.js';
import { createDatabasePool } from '../src/db/pool.js';
import { runMigrations } from '../src/db/migrate.js';
import { getTestDatabaseConfig } from './helpers.js';

const databaseConfig = getTestDatabaseConfig();

test(
  'PostgreSQL migrations and item API support CRUD and validation',
  { skip: !databaseConfig && 'requires the isolated backend_test PostgreSQL database' },
  async (t) => {
    if (!databaseConfig) {
      return;
    }

    const pool = createDatabasePool(databaseConfig);
    let app: ReturnType<typeof buildApp> | undefined;
    let appClosed = false;
    t.after(async () => {
      if (app && !appClosed) {
        await app.close();
      } else if (!app) {
        await pool.end();
      }
    });
    const firstMigrationRun = await runMigrations(pool);
    const secondMigrationRun = await runMigrations(pool);
    assert.deepEqual(secondMigrationRun, []);
    assert.ok(firstMigrationRun.length === 0 || firstMigrationRun.includes('001_create_items.sql'));
    await pool.query('TRUNCATE TABLE items');

    const runningApp = buildApp(
      {
        host: '127.0.0.1',
        port: 3000,
        logLevel: 'silent',
        instanceId: 'postgres-integration',
        database: databaseConfig,
      },
      { database: pool },
    );
    app = runningApp;
    t.after(() => runningApp.close());

    const createdResponse = await runningApp.inject({
      method: 'POST',
      url: '/api/items',
      payload: { name: '  Desk lamp  ', description: 'Adjustable' },
    });
    assert.equal(createdResponse.statusCode, 201);
    const created = createdResponse.json<{
      id: string;
      name: string;
      description: string;
      createdAt: string;
      updatedAt: string;
    }>();
    assert.match(created.id, /^[0-9a-f-]{36}$/);
    assert.equal(created.name, 'Desk lamp');
    assert.equal(created.description, 'Adjustable');
    assert.equal(new Date(created.createdAt).toISOString(), created.createdAt);
    assert.equal(new Date(created.updatedAt).toISOString(), created.updatedAt);

    const listResponse = await runningApp.inject({ method: 'GET', url: '/api/items' });
    assert.equal(listResponse.statusCode, 200);
    assert.deepEqual(listResponse.json(), [created]);

    const getResponse = await runningApp.inject({ method: 'GET', url: `/api/items/${created.id}` });
    assert.equal(getResponse.statusCode, 200);
    assert.deepEqual(getResponse.json(), created);

    const updateResponse = await runningApp.inject({
      method: 'PUT',
      url: `/api/items/${created.id}`,
      payload: { name: 'Desk lamp v2' },
    });
    assert.equal(updateResponse.statusCode, 200);
    const updated = updateResponse.json<typeof created>();
    assert.equal(updated.name, 'Desk lamp v2');
    assert.equal(updated.description, '');
    assert.equal(updated.id, created.id);

    const deleteResponse = await runningApp.inject({
      method: 'DELETE',
      url: `/api/items/${created.id}`,
    });
    assert.equal(deleteResponse.statusCode, 204);
    assert.equal(deleteResponse.body, '');

    for (const response of [
      await runningApp.inject({ method: 'GET', url: `/api/items/${created.id}` }),
      await runningApp.inject({
        method: 'PUT',
        url: `/api/items/${created.id}`,
        payload: { name: 'Missing item' },
      }),
      await runningApp.inject({ method: 'DELETE', url: `/api/items/${created.id}` }),
    ]) {
      assert.equal(response.statusCode, 404);
      assert.deepEqual(response.json(), { error: 'Item not found' });
    }

    for (const payload of [
      { name: '' },
      { name: '   ' },
      { name: 'valid', extra: 'unexpected' },
      { description: 'missing name' },
    ]) {
      const response = await runningApp.inject({ method: 'POST', url: '/api/items', payload });
      assert.equal(response.statusCode, 400);
    }
    assert.equal(
      (await runningApp.inject({ method: 'GET', url: '/api/items/not-a-uuid' })).statusCode,
      400,
    );

    await runningApp.close();
    appClosed = true;
    await assert.rejects(pool.query('SELECT 1'));
  },
);

test(
  'liveness remains available and readiness is generic when PostgreSQL is unavailable',
  { skip: !databaseConfig && 'requires the isolated test database settings' },
  async (t) => {
    if (!databaseConfig) {
      return;
    }

    const unavailablePool = createDatabasePool({
      ...databaseConfig,
      port: await getUnusedPort(),
      connectionTimeoutMs: 200,
      queryTimeoutMs: 300,
    });
    const app = buildApp(
      {
        host: '127.0.0.1',
        port: 3000,
        logLevel: 'silent',
        instanceId: 'database-unavailable-test',
        database: databaseConfig,
      },
      { database: unavailablePool },
    );
    let appClosed = false;
    t.after(async () => {
      if (!appClosed) {
        await app.close();
      }
    });

    const health = await app.inject({ method: 'GET', url: '/health' });
    assert.equal(health.statusCode, 200);
    assert.deepEqual(health.json(), { status: 'ok' });

    const ready = await app.inject({ method: 'GET', url: '/ready' });
    assert.equal(ready.statusCode, 503);
    assert.deepEqual(ready.json(), { status: 'unavailable' });
    assert.doesNotMatch(ready.body, /password|postgres|ECONNREFUSED/i);

    await app.close();
    appClosed = true;
    await assert.rejects(unavailablePool.query('SELECT 1'));
  },
);

async function getUnusedPort(): Promise<number> {
  const { createServer } = await import('node:net');
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Unable to allocate an unavailable database test port');
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return address.port;
}
