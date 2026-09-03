import { createApp } from './app';
import { env } from './env';
import { prisma } from './db';
import { logger } from './lib/logger';

const log = logger('api');

async function main() {
  await prisma.$connect();
  const app = createApp();
  const server = app.listen(env.port, () => {
    log.info(`API listening on http://localhost:${env.port}`);
    log.info(`Webhooks:  ${env.publicApiUrl}/api/webhooks/:channelCode`);
  });

  const shutdown = async () => {
    log.info('shutting down');
    server.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  log.error('failed to start', err);
  process.exit(1);
});
