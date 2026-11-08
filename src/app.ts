import Fastify from 'fastify';
import type { AppConfig } from './config/env.js';
import { createDatabasePool, type DatabasePool } from './db/pool.js';
import { registerDatabase } from './db/plugin.js';
import { registerItemRoutes } from './routes/items.js';
import { registerSystemRoutes } from './routes/system.js';

export interface BuildAppOptions {
  loggerStream?: {
    write(message: string): void;
  };
  database?: DatabasePool;
}

export function buildApp(config: AppConfig, options: BuildAppOptions = {}) {
  const app = Fastify({
    ajv: {
      customOptions: {
        removeAdditional: false,
      },
    },
    logger: {
      level: config.logLevel,
      serializers: {
        req: (request) => {
          const queryIndex = request.url.indexOf('?');
          return {
            method: request.method,
            url: queryIndex === -1 ? request.url : request.url.slice(0, queryIndex),
          };
        },
        err: (error) => ({
          type: error.name,
          message: 'Request failed',
          stack: '',
        }),
      },
      ...(options.loggerStream ? { stream: options.loggerStream } : {}),
    },
  });

  registerDatabase(app, options.database ?? createDatabasePool(config.database));

  app.setErrorHandler((error, request, reply) => {
    request.log.error(
      {
        errorType: error instanceof Error ? error.name : 'UnknownError',
        statusCode:
          typeof error === 'object' &&
          error !== null &&
          'statusCode' in error &&
          typeof error.statusCode === 'number'
            ? error.statusCode
            : 500,
      },
      'Request failed',
    );
    const statusCode =
      typeof error === 'object' &&
      error !== null &&
      'statusCode' in error &&
      typeof error.statusCode === 'number' &&
      Number.isInteger(error.statusCode) &&
      error.statusCode >= 400 &&
      error.statusCode <= 599
        ? error.statusCode
        : 500;
    const message = error instanceof Error ? error.message : 'Request failed';

    reply.status(statusCode).send({
      error: statusCode >= 500 ? 'Internal Server Error' : message,
    });
  });

  app.register(registerSystemRoutes, { instanceId: config.instanceId });
  app.register(registerItemRoutes);

  return app;
}
