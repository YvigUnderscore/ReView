// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createServer, type Server } from 'node:http';
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';
import { env } from '../config/env';
import { secretEquals } from '../lib/crypto';
import { logger } from '../lib/logger';
import { registerShutdownTask, SHUTDOWN_PHASE } from '../lib/gracefulShutdown';
import { appVersion } from '../lib/version';

/**
 * Observability for the worker process.
 *
 * Prometheus only scraped `backend:3000`: encode durations, failures per job type, and
 * the very existence of the worker process were measured nowhere. A dead worker only
 * showed up indirectly, as a `waiting` queue growing while `active` stays at
 * zero, and never before an artist complained.
 *
 * The worker therefore opens its own HTTP metrics endpoint, on the internal compose
 * network (`worker:9101/metrics`, no port published on the host). Registry separate from
 * the API's: both processes export `process_*`/`nodejs_*`, and Prometheus tells them apart by
 * the `job` label of the scrape, not by the series names.
 *
 * Guiding rule: **the metric must never take the worker down**. Port already taken,
 * client disconnects, serialization error: we log it and keep transcoding.
 */

/** Internal listen port. Never published on the host: Prometheus is on the same network. */
export const WORKER_METRICS_PORT = 9101;

export const workerRegistry = new Registry();
collectDefaultMetrics({ register: workerRegistry });

/** Instance version, as a constant series: "which version is running?" can be read in PromQL. */
const workerInfo = new Gauge({
  name: 'review_worker_info',
  help: 'Informations de build du worker (valeur constante 1)',
  labelNames: ['version', 'commit'],
  registers: [workerRegistry],
});
workerInfo.set({ version: appVersion.version, commit: appVersion.commit ?? 'unknown' }, 1);

const jobsTotal = new Counter({
  name: 'review_worker_jobs_total',
  help: 'Jobs traités par le worker, par file, type et issue',
  labelNames: ['queue', 'kind', 'outcome'],
  registers: [workerRegistry],
});

/**
 * Buckets spread out to one hour: a multi-rendition HLS transcode of a long clip does not
 * measure on the scale of an HTTP request.
 */
const jobDuration = new Histogram({
  name: 'review_worker_job_duration_seconds',
  help: 'Durée de traitement des jobs du worker',
  labelNames: ['queue', 'kind'],
  buckets: [1, 5, 15, 30, 60, 120, 300, 600, 1800, 3600],
  registers: [workerRegistry],
});

export type JobOutcome = 'completed' | 'failed';

/** Work type of a BullMQ job: `data.kind` if present, otherwise its name. */
export function jobKind(job: unknown): string {
  const candidate = job as { data?: { kind?: unknown }; name?: unknown } | null | undefined;
  const kind = candidate?.data?.kind;
  if (typeof kind === 'string' && kind) return kind;
  return typeof candidate?.name === 'string' && candidate.name ? candidate.name : 'unknown';
}

/**
 * Processing duration in seconds. BullMQ timestamps `processedOn` and `finishedOn`; a job
 * that stalled (worker killed) has no `finishedOn`, so we return `null` rather than an invented duration.
 */
export function jobDurationSec(job: unknown, now: number = Date.now()): number | null {
  const stamps = job as { processedOn?: unknown; finishedOn?: unknown } | null | undefined;
  const started = typeof stamps?.processedOn === 'number' ? stamps.processedOn : null;
  const finished = typeof stamps?.finishedOn === 'number' ? stamps.finishedOn : null;
  if (started === null) return null;
  return Math.max(0, ((finished ?? now) - started) / 1000);
}

/** Records the outcome of a job (exported for tests and for direct calls). */
export function observeWorkerJob(
  queue: string,
  kind: string,
  outcome: JobOutcome,
  durationSec: number | null,
): void {
  jobsTotal.inc({ queue, kind, outcome });
  if (durationSec !== null) jobDuration.observe({ queue, kind }, durationSec);
}

/** Minimal surface of a BullMQ `Worker` as seen from here: its two terminal events. */
export interface JobEventSource {
  on(event: 'completed', listener: (job: unknown) => void): unknown;
  on(event: 'failed', listener: (job: unknown, err: unknown) => void): unknown;
}

/**
 * Hooks the counters onto a queue consumer. To be called for each of the seven
 * consumers started by the worker process bootstrap: without it, only the process
 * state is measured, not its work.
 */
export function attachWorkerMetrics(queue: string, worker: JobEventSource): void {
  worker.on('completed', (job) => observeWorkerJob(queue, jobKind(job), 'completed', jobDurationSec(job)));
  worker.on('failed', (job) => observeWorkerJob(queue, jobKind(job), 'failed', jobDurationSec(job)));
}

/** Expected token, read from the URL or the `Authorization` header (same rule as the API). */
export function providedToken(
  url: string | undefined,
  authorization: string | undefined,
): string | undefined {
  const fromHeader = authorization?.split(' ')[1];
  if (fromHeader) return fromHeader;
  try {
    return new URL(url ?? '/', 'http://worker.local').searchParams.get('token') ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Opens the scrape endpoint and registers its own shutdown. The server is returned
 * for tests; the production caller does nothing with it.
 */
export function startWorkerMetricsServer(port: number = WORKER_METRICS_PORT): Server {
  const server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    if (path !== '/metrics') {
      res.writeHead(404).end();
      return;
    }
    if (
      env.METRICS_TOKEN &&
      !secretEquals(providedToken(req.url, req.headers.authorization), env.METRICS_TOKEN)
    ) {
      res.writeHead(401).end();
      return;
    }
    workerRegistry
      .metrics()
      .then((body) => {
        res.writeHead(200, { 'Content-Type': workerRegistry.contentType }).end(body);
      })
      .catch((err: unknown) => {
        logger.warn({ err }, '[worker.metrics] sérialisation impossible');
        res.writeHead(500).end();
      });
  });

  // A metric must not bring the worker down: port already taken, we say so and carry on.
  server.on('error', (err) => logger.warn({ err, port }, '[worker.metrics] écoute impossible'));
  server.listen(port, () => {
    const bound = server.address();
    const actual = typeof bound === 'object' && bound ? bound.port : port;
    logger.info(`[worker.metrics] /metrics sur le port ${actual}`);
  });

  registerShutdownTask({
    name: 'worker-metrics',
    phase: SHUTDOWN_PHASE.STOP_INTAKE,
    run: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
    force: () => server.closeAllConnections(),
  });

  return server;
}
