import { hostname } from 'node:os';
import type { FastifyInstance } from 'fastify';

export interface SystemRouteOptions {
  instanceId: string;
}

export async function registerSystemRoutes(
  app: FastifyInstance,
  options: SystemRouteOptions,
): Promise<void> {
  app.get('/health', async () => ({ status: 'ok' }));

  app.get('/ready', async (_request, reply) => {
    try {
      await app.db.query('SELECT 1');
      return { status: 'ready' };
    } catch (error) {
      app.log.warn(
        { errorType: error instanceof Error ? error.name : 'UnknownError' },
        'Readiness check failed',
      );
      return reply.code(503).send({ status: 'unavailable' });
    }
  });

  app.get('/api/instance', async () => ({
    instanceId: options.instanceId,
    hostname: hostname(),
    timestamp: new Date().toISOString(),
  }));
}
