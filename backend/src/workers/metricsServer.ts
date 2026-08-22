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
 * Observabilité du process worker.
 *
 * Prometheus ne scrutait que `backend:3000` : la durée d'un encodage, les échecs par type
 * de job et l'existence même du process worker n'étaient mesurés nulle part. Un worker mort
 * ne se voyait qu'indirectement — une file `waiting` qui monte pendant que `active` reste à
 * zéro — et jamais avant qu'un artiste ne se plaigne.
 *
 * Le worker ouvre donc son propre point de collecte HTTP, sur le réseau interne du compose
 * (`worker:9101/metrics`, aucun port publié sur l'hôte). Registre distinct de celui de
 * l'API : les deux process exportent `process_*`/`nodejs_*` et Prometheus les distingue par
 * l'étiquette `job` du scrape, pas par le nom des séries.
 *
 * Règle de fond : **la métrique ne doit jamais mettre le worker en défaut**. Port déjà pris,
 * client qui coupe, sérialisation en erreur — on journalise et on continue de transcoder.
 */

/** Port d'écoute interne. Jamais publié sur l'hôte : Prometheus est sur le même réseau. */
export const WORKER_METRICS_PORT = 9101;

export const workerRegistry = new Registry();
collectDefaultMetrics({ register: workerRegistry });

/** Version de l'instance, en série constante : « quelle version tourne ? » se lit en PromQL. */
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
 * Buckets étalés jusqu'à l'heure : un transcodage HLS multi-rendition d'un plan long ne se
 * mesure pas avec l'échelle d'une requête HTTP.
 */
const jobDuration = new Histogram({
  name: 'review_worker_job_duration_seconds',
  help: 'Durée de traitement des jobs du worker',
  labelNames: ['queue', 'kind'],
  buckets: [1, 5, 15, 30, 60, 120, 300, 600, 1800, 3600],
  registers: [workerRegistry],
});

export type JobOutcome = 'completed' | 'failed';

/** Type de travail d'un job BullMQ : `data.kind` s'il existe, sinon son nom. */
export function jobKind(job: unknown): string {
  const candidate = job as { data?: { kind?: unknown }; name?: unknown } | null | undefined;
  const kind = candidate?.data?.kind;
  if (typeof kind === 'string' && kind) return kind;
  return typeof candidate?.name === 'string' && candidate.name ? candidate.name : 'unknown';
}

/**
 * Durée de traitement en secondes. BullMQ horodate `processedOn` et `finishedOn` ; un job
 * calé (worker tué) n'a pas de `finishedOn` — on rend `null` plutôt qu'une durée inventée.
 */
export function jobDurationSec(job: unknown, now: number = Date.now()): number | null {
  const stamps = job as { processedOn?: unknown; finishedOn?: unknown } | null | undefined;
  const started = typeof stamps?.processedOn === 'number' ? stamps.processedOn : null;
  const finished = typeof stamps?.finishedOn === 'number' ? stamps.finishedOn : null;
  if (started === null) return null;
  return Math.max(0, ((finished ?? now) - started) / 1000);
}

/** Enregistre l'issue d'un job (exporté pour les tests et pour un appel direct). */
export function observeWorkerJob(
  queue: string,
  kind: string,
  outcome: JobOutcome,
  durationSec: number | null,
): void {
  jobsTotal.inc({ queue, kind, outcome });
  if (durationSec !== null) jobDuration.observe({ queue, kind }, durationSec);
}

/** Surface minimale d'un `Worker` BullMQ vue d'ici : ses deux événements terminaux. */
export interface JobEventSource {
  on(event: 'completed', listener: (job: unknown) => void): unknown;
  on(event: 'failed', listener: (job: unknown, err: unknown) => void): unknown;
}

/**
 * Branche les compteurs sur un consommateur de file. À appeler pour chacun des cinq
 * workers : sans cela, seul l'état du process est mesuré, pas son travail.
 */
export function attachWorkerMetrics(queue: string, worker: JobEventSource): void {
  worker.on('completed', (job) => observeWorkerJob(queue, jobKind(job), 'completed', jobDurationSec(job)));
  worker.on('failed', (job) => observeWorkerJob(queue, jobKind(job), 'failed', jobDurationSec(job)));
}

/** Jeton attendu, lu dans l'URL ou dans l'en-tête `Authorization` (même règle que l'API). */
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
 * Ouvre le point de collecte et enregistre lui-même son extinction. Le serveur est rendu
 * pour les tests ; l'appelant de production n'en fait rien.
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

  // Une métrique ne fait pas tomber un worker : port déjà pris, on le dit et on continue.
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
