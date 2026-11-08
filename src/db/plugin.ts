import type { FastifyInstance } from 'fastify';
import type { DatabasePool } from './pool.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: DatabasePool;
  }
}

export function registerDatabase(app: FastifyInstance, pool: DatabasePool): void {
  app.decorate('db', pool);
  app.addHook('onClose', async () => {
    await pool.end();
  });
}
