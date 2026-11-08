import { buildApp } from './app.js';
import { loadConfig } from './config/env.js';

async function start(): Promise<void> {
  let app: ReturnType<typeof buildApp> | undefined;
  try {
    const config = loadConfig();
    app = buildApp(config);

    const shutdown = async (signal: string): Promise<void> => {
      app?.log.info({ signal }, 'Shutting down');
      await app?.close();
    };

    process.once('SIGINT', () => {
      void shutdown('SIGINT');
    });
    process.once('SIGTERM', () => {
      void shutdown('SIGTERM');
    });

    await app.listen({ host: config.host, port: config.port });
    app.log.info('Server listening');
  } catch (error) {
    if (app) {
      app.log.error(
        { errorType: error instanceof Error ? error.name : 'UnknownError' },
        'Server failed to start',
      );
      await app.close();
    } else {
      console.error(error instanceof Error ? error.message : 'Invalid server configuration');
    }
    process.exitCode = 1;
  }
}

await start();
