// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Request, Response, NextFunction } from 'express';
import { Registry, collectDefaultMetrics, Histogram, Gauge } from 'prom-client';
import { ALL_QUEUES } from './queues';
import { logger } from './logger';

/**
 * Prometheus metrics (37.G): default Node metrics + HTTP latency per aggregated route + BullMQ queue depth
 * (refreshed every 15 s).
 * Exposed on GET /metrics (optional METRICS_TOKEN — see app.ts).
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

/** Aggregated route (ids become :id) to bound the cardinality of the labels. */
export function normalizeRoute(path: string): string {
  return (
    path
      .split('?')[0]!
      // Long hex tokens/hashes (shares) first — they often start with digits
      .replace(/\/[0-9a-f]{16,}/gi, '/:token')
      .replace(/\/\d+/g, '/:id')
      .slice(0, 80)
  );
}

/**
 * Every distinct value of the `route` label creates a persistent series in the Prometheus registry. This middleware is
 * mounted before the global rate limiter and therefore sees all URLs, including those matching no route: unbounded,
 * hammering random paths grows the registry indefinitely — remote memory exhaustion, without authentication.
 *
 * The catalogue is therefore only enriched on a SUCCESSFUL response (status < 400): only a real route produces one.
 * A 404 (non-existent path) as well as a 400 (`/api/media/abc`, whose validation rejects the parameter) are the tools of
 * the sweep — they are aggregated under `/other` without ever consuming a slot. Once a route is known, it keeps its
 * label whatever its status: the error rates of real routes therefore stay visible.
 * The number of distinct routes is also capped, any overflow falling back to `/other`.
 */
const MAX_ROUTE_LABELS = 300;
const OTHER_ROUTE = '/other';
const seenRoutes = new Set<string>();

/** Route label actually used, with bounded cardinality. */
export function routeLabel(originalUrl: string, statusCode: number): string {
  const route = normalizeRoute(originalUrl);
  if (seenRoutes.has(route)) return route;
  if (statusCode >= 400) return OTHER_ROUTE;
  if (seenRoutes.size >= MAX_ROUTE_LABELS) return OTHER_ROUTE;
  seenRoutes.add(route);
  return route;
}

/** Express middleware: latency histogram by method/route/status. */
export function httpMetrics(req: Request, res: Response, next: NextFunction): void {
  const end = httpDuration.startTimer();
  res.on('finish', () => {
    end({
      method: req.method,
      route: routeLabel(req.originalUrl, res.statusCode),
      status: String(res.statusCode),
    });
  });
  next();
}

export const __testing = { seenRoutes, MAX_ROUTE_LABELS, OTHER_ROUTE };

async function refreshQueueGauges(): Promise<void> {
  // The five declared queues, plus maintenance: `timeline-export` and `shotgrid` were absent from the registry, hence
  // invisible from the Grafana dashboard as from any alert.
  for (const [name, q] of ALL_QUEUES) {
    const counts = await q.getJobCounts('waiting', 'active', 'failed', 'delayed');
    for (const [state, value] of Object.entries(counts)) {
      queueGauge.set({ queue: name, state }, value);
    }
  }
}

/** Starts the periodic refresh of the queue gauges (server only). */
export function startQueueMetrics(): void {
  const tick = () =>
    void refreshQueueGauges().catch((err) => logger.warn({ err }, '[metrics] files illisibles'));
  tick();
  setInterval(tick, 15_000).unref();
}
