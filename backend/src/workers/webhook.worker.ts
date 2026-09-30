// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Worker } from 'bullmq';
import { redisConnectionOptions } from '../lib/redis';
import { QUEUE_NAMES, type WebhookJobData } from '../services/JobService';
import { deliver } from '../services/WebhookService';
import { logger } from '../lib/logger';
import { registerWorkerShutdown } from './shutdown';

/**
 * Worker de livraison des webhooks (36.D) — tourne dans le process worker (comme le
 * nettoyage storage) : les requêtes sortantes ne partent pas du serveur web.
 * Échec → BullMQ retente (5 tentatives, backoff exponentiel).
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
  logger.info('[webhook.worker] démarré.');
}
