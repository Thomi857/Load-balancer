import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createServer } from 'node:net';
import { Agent, request as httpRequest } from 'node:http';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { getTestDatabaseConfig, prepareTestDatabase, testDatabaseEnvironment } from './helpers.js';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const serverEntry = fileURLToPath(new URL('../dist/server.js', import.meta.url));
const testDatabaseConfig = getTestDatabaseConfig();

interface ExitResult {
  code: number | null;
  signal: NodeJS.Signals | null;
}

interface RunningServer {
  child: ChildProcessWithoutNullStreams;
  port: number;
  closed: Promise<ExitResult>;
  output: () => string;
}

async function reservePort(): Promise<number> {
  const listener = createServer();
  await new Promise<void>((resolve, reject) => {
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', resolve);
  });

  const address = listener.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Unable to allocate an integration-test port');
  }

  await new Promise<void>((resolve, reject) => {
    listener.close((error) => (error ? reject(error) : resolve()));
  });
  return address.port;
}

async function spawnServer(overrides: NodeJS.ProcessEnv = {}): Promise<RunningServer> {
  const port = await reservePort();
  const child = spawn(process.execPath, [serverEntry], {
    cwd: projectRoot,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      INSTANCE_ID: 'integration-instance',
      ...(testDatabaseConfig ? testDatabaseEnvironment(testDatabaseConfig) : {}),
      ...overrides,
    },
    stdio: 'pipe',
  });

  let output = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    output += chunk;
  });
  child.stderr.on('data', (chunk: string) => {
    output += chunk;
  });

  const closed = new Promise<ExitResult>((resolve) => {
    child.once('close', (code, signal) => resolve({ code, signal }));
  });

  return { child, port, closed, output: () => output };
}

async function waitForReady(server: RunningServer): Promise<void> {
  const deadline = Date.now() + 5000;
  const url = `http://127.0.0.1:${server.port}/health`;

  while (Date.now() < deadline) {
    if (server.child.exitCode !== null || server.child.signalCode !== null) {
      throw new Error(`Server exited before becoming ready:\n${server.output()}`);
    }

    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(250) });
      if (response.status === 200) {
        return;
      }
    } catch {
      // The listener may not have bound its port yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error(`Server did not become ready in time:\n${server.output()}`);
}

async function waitForExit(server: RunningServer, timeoutMs: number): Promise<ExitResult> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      server.closed,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Server did not exit in time')), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

async function stopServer(server: RunningServer): Promise<void> {
  if (server.child.exitCode === null && server.child.signalCode === null) {
    server.child.kill('SIGTERM');
  }

  try {
    await waitForExit(server, 2000);
  } catch {
    server.child.kill('SIGKILL');
    await waitForExit(server, 2000);
  }
}

interface JsonResponse {
  statusCode: number;
  body: unknown;
}

interface InstanceResponse {
  instanceId: string;
  hostname: string;
  timestamp: string;
}

function isInstanceResponse(value: unknown): value is InstanceResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    'instanceId' in value &&
    typeof value.instanceId === 'string' &&
    'hostname' in value &&
    typeof value.hostname === 'string' &&
    'timestamp' in value &&
    typeof value.timestamp === 'string'
  );
}

function requestJson(port: number, path: string, agent?: Agent): Promise<JsonResponse> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        host: '127.0.0.1',
        port,
        path,
        method: 'GET',
        ...(agent ? { agent } : {}),
      },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => {
          body += chunk;
        });
        response.on('end', () => {
          try {
            resolve({
              statusCode: response.statusCode ?? 0,
              body: JSON.parse(body) as unknown,
            });
          } catch (error) {
            reject(error);
          }
        });
      },
    );

    request.setTimeout(1500, () => request.destroy(new Error('HTTP request timed out')));
    request.once('error', reject);
    request.end();
  });
}

test(
  'compiled server serves the public API over HTTP',
  { skip: !testDatabaseConfig && 'requires the isolated backend_test PostgreSQL database' },
  async (t) => {
    await prepareTestDatabase();
    const server = await spawnServer();
    t.after(() => stopServer(server));
    await waitForReady(server);

    const health = await requestJson(server.port, '/health');
    assert.equal(health.statusCode, 200);
    assert.deepEqual(health.body, { status: 'ok' });

    const ready = await requestJson(server.port, '/ready');
    assert.equal(ready.statusCode, 200);
    assert.deepEqual(ready.body, { status: 'ready' });

    const instance = await requestJson(server.port, '/api/instance');
    assert.equal(instance.statusCode, 200);
    assert.ok(isInstanceResponse(instance.body));
    assert.deepEqual(Object.keys(instance.body).sort(), ['hostname', 'instanceId', 'timestamp']);
    const instanceBody = instance.body;
    assert.equal(instanceBody.instanceId, 'integration-instance');
    assert.ok(instanceBody.hostname.length > 0);
    assert.equal(new Date(instanceBody.timestamp).toISOString(), instanceBody.timestamp);
  },
);

test('invalid environment configuration exits non-zero without starting', async (t) => {
  const server = await spawnServer({ PORT: 'not-a-port' });
  t.after(() => stopServer(server));

  const result = await waitForExit(server, 3000);
  assert.equal(result.code, 1);
  assert.equal(result.signal, null);
  assert.match(server.output(), /PORT must be an integer between 1 and 65535/);
  assert.doesNotMatch(server.output(), /at loadConfig/);
  assert.doesNotMatch(server.output(), /Server listening/);
});

test(
  'SIGTERM stops the server and closes existing keep-alive connections',
  { skip: !testDatabaseConfig && 'requires the isolated backend_test PostgreSQL database' },
  async (t) => {
    await prepareTestDatabase();
    const server = await spawnServer();
    const agent = new Agent({ keepAlive: true });
    t.after(async () => {
      agent.destroy();
      await stopServer(server);
    });
    await waitForReady(server);

    const existingResponse = await requestJson(server.port, '/health', agent);
    assert.equal(existingResponse.statusCode, 200);
    assert.ok(
      Object.values(agent.freeSockets).some(
        (sockets) => sockets !== undefined && sockets.length > 0,
      ),
    );

    assert.equal(server.child.kill('SIGTERM'), true);
    const result = await waitForExit(server, 3000);
    assert.equal(result.code, 0);
    assert.equal(result.signal, null);
    assert.match(server.output(), /"signal":"SIGTERM"/);
    assert.match(server.output(), /Shutting down/);

    await assert.rejects(requestJson(server.port, '/health'));
    await assert.rejects(requestJson(server.port, '/health', agent));
  },
);
