// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { getRedis } from '../lib/redis';
import { storage } from '../services/StorageService';
import { getSourceUrl } from '../lib/settings';
import { appVersion } from '../lib/version';

/**
 * Sondes de santé et version de l'instance.
 *
 * `GET /health` répondait « ok » sans rien toucher : un backend dont le pool de connexions
 * est mort restait « healthy » et continuait de recevoir du trafic. On sépare donc les deux
 * questions, qui n'ont pas les mêmes réponses :
 *
 *  - **vivacité** (`/health`, `/health/live`) — le process répond-il ? Aucune E/S, jamais
 *    d'échec sur une dépendance : c'est la sonde de `docker compose`, et redémarrer un
 *    conteneur parce que Postgres est tombé ne ferait qu'ajouter une panne à la panne ;
 *  - **disponibilité** (`/health/ready`) — l'instance peut-elle réellement servir ? Base,
 *    Redis et MinIO sont interrogés, chacun sous délai maximal ; toute dépendance en défaut
 *    donne un **503**, ce qu'un frontal ou une supervision externe savent lire.
 *
 * La sonde de disponibilité est bornée en charge par construction : chaque contrôle a un
 * délai, le résultat est mémorisé quelques secondes, et les appels concurrents partagent la
 * même exécution. Marteler `/health/ready` coûte donc, au pire, un aller-retour par
 * dépendance toutes les `READY_CACHE_MS` — sans quoi la sonde serait elle-même le vecteur
 * de charge qui achève une instance déjà en difficulté.
 *
 * Surface publique (aucune authentification) : elle porte donc, comme `/api/docs`, l'offre
 * de code source correspondant exigée par l'AGPL §13 — c'est aussi la seule façon pour un
 * utilisateur de savoir *quelles* sources correspondent à l'instance qu'il utilise.
 */

/** Délai maximal d'un contrôle de dépendance. Au-delà, la dépendance est réputée absente. */
export const CHECK_TIMEOUT_MS = 2_000;
/** Durée de validité d'un résultat de disponibilité (protège des sondes trop fréquentes). */
export const READY_CACHE_MS = 5_000;

export interface CheckResult {
  ok: boolean;
  /** Durée du contrôle en millisecondes (mesurée même en cas d'échec). */
  ms: number;
  /** Motif d'échec, borné : un message d'erreur brut peut porter une URL de connexion. */
  error?: string;
}

export interface ReadinessReport {
  ok: boolean;
  checks: Record<string, CheckResult>;
}

/** Motif d'échec exploitable, sans divulguer d'identifiants ni de topologie. */
export function failureReason(err: unknown): string {
  if (err instanceof Error && err.message) return err.message.slice(0, 120);
  return 'unavailable';
}

/**
 * Exécute un contrôle sous délai maximal. Le `timeout` ne se contente pas de rendre la
 * main : sans lui, une dépendance qui ne répond jamais (Redis injoignable, socket ouverte
 * mais muette) ferait pendre la requête de supervision — le mode de panne exact de
 * `GET /api/admin/system`.
 */
export async function timedCheck(
  run: () => Promise<unknown>,
  timeoutMs = CHECK_TIMEOUT_MS,
  now: () => number = Date.now,
): Promise<CheckResult> {
  const started = now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      run(),
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
    return { ok: true, ms: now() - started };
  } catch (err) {
    return { ok: false, ms: now() - started, error: failureReason(err) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Joue tous les contrôles en parallèle : la sonde dure le plus lent, pas leur somme. */
export async function runChecks(
  probes: Record<string, () => Promise<unknown>>,
  timeoutMs = CHECK_TIMEOUT_MS,
): Promise<ReadinessReport> {
  const entries = await Promise.all(
    Object.entries(probes).map(async ([name, run]) => [name, await timedCheck(run, timeoutMs)] as const),
  );
  const checks = Object.fromEntries(entries);
  return { ok: entries.every(([, result]) => result.ok), checks };
}

/**
 * Mémorise le dernier rapport et regroupe les appels concurrents. Deux superviseurs et un
 * frontal qui sondent en même temps ne produisent qu'une seule interrogation des dépendances.
 */
export function createReadinessCache(
  run: () => Promise<ReadinessReport>,
  ttlMs = READY_CACHE_MS,
  now: () => number = Date.now,
): () => Promise<ReadinessReport & { cached: boolean }> {
  let last: { at: number; report: ReadinessReport } | null = null;
  let inFlight: Promise<ReadinessReport> | null = null;

  return async () => {
    if (last && now() - last.at < ttlMs) return { ...last.report, cached: true };
    const pending = (inFlight ??= run()
      .then((report) => {
        last = { at: now(), report };
        return report;
      })
      .finally(() => {
        inFlight = null;
      }));
    return { ...(await pending), cached: false };
  };
}

/** Les trois dépendances sans lesquelles l'instance ne sert rien d'utile. */
export const dependencyProbes: Record<string, () => Promise<unknown>> = {
  database: () => prisma.$queryRaw`SELECT 1`,
  redis: () => getRedis().call('PING'),
  storage: async () => {
    if (!(await storage.ping())) throw new Error('bucket unreachable');
  },
};

/** Vivacité : aucune E/S, aucune dépendance. Répond tant que la boucle d'événements tourne. */
const liveness = (): Record<string, unknown> => ({
  status: 'ok',
  version: appVersion.version,
  commit: appVersion.commit,
  uptimeSec: Math.round(process.uptime()),
});

/**
 * Construit le routeur de santé. Paramétrable pour que les tests éprouvent le 503 sans
 * dépendre de l'état mémorisé du routeur réel (le cache est justement partagé par tous les
 * appels : c'est ce qu'on veut en production, pas dans une suite de tests).
 */
export function buildHealthRouter(
  probes: Record<string, () => Promise<unknown>> = dependencyProbes,
  ttlMs = READY_CACHE_MS,
): Router {
  const readiness = createReadinessCache(() => runChecks(probes), ttlMs);
  const router = Router();

  router.get('/', (_req, res) => {
    res.json(liveness());
  });

  router.get('/live', (_req, res) => {
    res.json(liveness());
  });

  router.get('/ready', async (_req, res) => {
    const report = await readiness();
    res.status(report.ok ? 200 : 503).json({
      status: report.ok ? 'ready' : 'degraded',
      version: appVersion.version,
      commit: appVersion.commit,
      cached: report.cached,
      checks: report.checks,
    });
  });

  return router;
}

export default buildHealthRouter();

/**
 * Version de l'instance, publique (`GET /api/version`) : le support, la supervision et
 * l'écran « À propos » de l'administration lisent la même source. Publier la version d'un
 * logiciel AGPL n'est pas une fuite — l'§13 impose au contraire de pouvoir désigner les
 * sources *correspondantes*, ce que le couple version + commit permet seul.
 */
export const versionRouter = Router();

versionRouter.get('/', async (_req, res) => {
  res.json({
    version: appVersion.version,
    commit: appVersion.commit,
    builtAt: appVersion.builtAt,
    node: process.version,
    source: await getSourceUrl(),
  });
});
