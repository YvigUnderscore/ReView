// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { prisma } from './prisma';
import { getRedis } from './redis';
import { storage } from '../services/StorageService';

/**
 * Mécanique des sondes de santé : délais, exécution parallèle, mémorisation.
 *
 * Sortie de la route pour deux raisons. La convention du projet veut que la logique vive
 * dans lib/ et que la route se contente de valider puis répondre ; et le fichier de route
 * dépassait son budget de 200 lignes, que l'on tient en extrayant, jamais en désactivant
 * la règle. Ce qui reste ici ne parle à personne : ce sont des fonctions pures, plus la
 * liste des dépendances à interroger.
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
