import cron from 'node-cron';
import { env } from '../env';
import { logger } from '../lib/logger';
import { prisma } from '../db';
import { pollPullChannels, runDueJobs } from './job-runner';
import { runNightlyPricing } from '../engine/pricing';

const log = logger('worker');

let running = false;

async function tick() {
  if (running) return;
  running = true;
  try {
    const jobs = await runDueJobs(25);
    if (jobs.processed > 0) log.info(`drained ${jobs.processed} job(s) — ok ${jobs.ok}, failed ${jobs.failed}`);
  } catch (err) {
    log.error('job drain error', err);
  } finally {
    running = false;
  }
}

let polling = false;
async function pollTick() {
  if (polling) return;
  polling = true;
  try {
    const res = await pollPullChannels();
    if (res.ingested > 0) log.info(`poll ingested ${res.ingested} booking(s) across ${res.polled} channel(s)`);
  } catch (err) {
    log.error('poll error', err);
  } finally {
    polling = false;
  }
}

async function main() {
  log.info(`worker starting — job interval ${env.workerPollIntervalMs}ms, poll interval ${env.workerPullIntervalMs}ms`);
  await prisma.$connect();

  const jobTimer = setInterval(tick, env.workerPollIntervalMs);
  const pollTimer = setInterval(pollTick, env.workerPullIntervalMs);
  void tick();
  void pollTick();

  // RMS: reprice every property/room with active pricing rules, once a night.
  const pricingTask = cron.schedule('0 2 * * *', () => {
    log.info('running nightly RMS pricing pass');
    runNightlyPricing().catch((err) => log.error('nightly pricing pass failed', err));
  });

  const shutdown = async () => {
    log.info('worker stopping');
    clearInterval(jobTimer);
    clearInterval(pollTimer);
    pricingTask.stop();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  log.error('worker crashed', err);
  process.exit(1);
});
