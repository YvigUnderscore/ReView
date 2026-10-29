// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Worker } from 'bullmq';
import { redisConnectionOptions } from '../lib/redis';
import { QUEUE_NAMES, type WebhookJobData } from '../services/JobService';
import { deliver } from '../services/WebhookService';
import { logger } from '../lib/logger';
import { registerWorkerShutdown } from './shutdown';

/**
 * Webhook delivery worker (36.D): runs in the worker process (like
 * storage cleanup), so outgoing requests do not leave from the web server.
 * Failure → BullMQ retries (5 attempts, exponential backoff).
 */
export const webhookWorker = new Worker<WebhookJobData, void, string>(
  QUEUE_NAMES.WEBHOOKS,
  async (job) => deliver(job.data.webhookId, job.data.event, job.data.payload),
  { connection: redisConnectionOptions, autorun: false, concurrency: 3 },
);

webhookWorker.on('completed', (job) =>
  logger.info(`[webhook.worker] ✓ ${job.data.event} → webhook ${job.data.webhookId}`),
);
webhookWorker.on('failed', (job, err) =>
  logger.warn({ err }, `[webhook.worker] ✗ ${job?.data.event} → webhook ${job?.data.webhookId}`),
);

export function startWebhookWorker(): void {
  void webhookWorker.run();
  registerWorkerShutdown('webhook.worker', webhookWorker);
  logger.info('[webhook.worker] started.');
}
