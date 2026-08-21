// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Request, Response, NextFunction } from 'express';
import { Registry, collectDefaultMetrics, Histogram, Gauge } from 'prom-client';
import { ALL_QUEUES } from '../services/JobService';
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

/**
 * Chaque valeur distincte du label `route` crée une série persistante dans le registre
 * Prometheus. Ce middleware est monté avant le rate limiter global et voit donc toutes les
 * URLs, y compris celles qui ne correspondent à aucune route : sans borne, marteler des
 * chemins aléatoires fait grossir le registre indéfiniment — épuisement mémoire à distance,
 * sans authentification.
 *
 * Le catalogue ne s'enrichit donc que sur une réponse ABOUTIE (statut < 400) : seule une
 * vraie route en produit. Un 404 (chemin inexistant) comme un 400 (`/api/media/abc`, dont la
 * validation rejette le paramètre) sont l'outil du balayage — ils sont agrégés sous `/other`
 * sans jamais consommer de place. Une fois une route connue, elle garde son étiquette quel
 * que soit son statut : les taux d'erreur des vraies routes restent donc visibles.
 * Le nombre de routes distinctes est en outre plafonné, tout dépassement retombant sur `/other`.
 */
const MAX_ROUTE_LABELS = 300;
const OTHER_ROUTE = '/other';
const seenRoutes = new Set<string>();

/** Étiquette de route effectivement utilisée, cardinalité bornée. */
export function routeLabel(originalUrl: string, statusCode: number): string {
  const route = normalizeRoute(originalUrl);
  if (seenRoutes.has(route)) return route;
  if (statusCode >= 400) return OTHER_ROUTE;
  if (seenRoutes.size >= MAX_ROUTE_LABELS) return OTHER_ROUTE;
  seenRoutes.add(route);
  return route;
}

/** Middleware Express : histogramme de latence par méthode/route/statut. */
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
  // Les cinq files déclarées, plus l'entretien : `timeline-export` et `shotgrid` étaient
  // absentes du registre, donc invisibles du tableau Grafana comme de toute alerte.
  for (const [name, q] of ALL_QUEUES) {
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
