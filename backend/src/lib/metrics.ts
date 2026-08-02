// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Request, Response, NextFunction } from 'express';
import { Registry, collectDefaultMetrics, Histogram, Gauge } from 'prom-client';
import { mediaQueue, storageCleanupQueue, webhookQueue } from '../services/JobService';
import { logger } from './logger';

/**
 * Métriques Prometheus (37.G) : métriques Node par défaut + latence HTTP par route
 * agrégée + profondeur des files BullMQ (rafraîchie toutes les 15 s).
 * Exposées sur GET /metrics (jeton optionnel METRICS_TOKEN — voir app.ts).
 */

export const registry = new Registry();
collectDefaultMetrics({ register: registry });

const httpDuration = new Histogram({
  name: 'review_http_request_duration_seconds',
  help: 'Durée des requêtes HTTP',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

const queueGauge = new Gauge({
  name: 'review_queue_jobs',
  help: 'Jobs BullMQ par file et par état',
  labelNames: ['queue', 'state'],
  registers: [registry],
});

/** Route agrégée (les ids deviennent :id) pour borner la cardinalité des labels. */
export function normalizeRoute(path: string): string {
  return (
    path
      .split('?')[0]!
      // tokens/hash hex longs (partages) d'abord — ils commencent souvent par des chiffres
      .replace(/\/[0-9a-f]{16,}/gi, '/:token')
      .replace(/\/\d+/g, '/:id')
      .slice(0, 80)
  );
}

/** Middleware Express : histogramme de latence par méthode/route/statut. */
export function httpMetrics(req: Request, res: Response, next: NextFunction): void {
  const end = httpDuration.startTimer();
  res.on('finish', () => {
    end({ method: req.method, route: normalizeRoute(req.originalUrl), status: String(res.statusCode) });
  });
  next();
}

const QUEUES = [
  ['media', mediaQueue],
  ['storage-cleanup', storageCleanupQueue],
  ['webhooks', webhookQueue],
] as const;

async function refreshQueueGauges(): Promise<void> {
  for (const [name, q] of QUEUES) {
    const counts = await q.getJobCounts('waiting', 'active', 'failed', 'delayed');
    for (const [state, value] of Object.entries(counts)) {
      queueGauge.set({ queue: name, state }, value);
    }
  }
}

/** Démarre le rafraîchissement périodique des gauges de files (serveur uniquement). */
export function startQueueMetrics(): void {
  const tick = () =>
    void refreshQueueGauges().catch((err) => logger.warn({ err }, '[metrics] files illisibles'));
  tick();
  setInterval(tick, 15_000).unref();
}
