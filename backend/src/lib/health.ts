// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { prisma } from './prisma';
import { getRedis } from './redis';
import { storage } from '../services/StorageService';

/**
 * Health probe mechanics: timeouts, parallel execution, memoisation.
 *
 * Moved out of the route for two reasons. The project convention is that logic lives in lib/ and the route
 * only validates then responds; and the route file was over its 200-line budget, which is addressed by
 * extracting, never by disabling the rule. What remains here speaks to nobody: they are pure functions, plus
 * the list of dependencies to query.
 */

/** Maximum delay of a dependency check. Beyond it, the dependency is deemed absent. */
export const CHECK_TIMEOUT_MS = 2_000;
/** Validity period of an availability result (protects against over-frequent probes). */
export const READY_CACHE_MS = 5_000;

export interface CheckResult {
  ok: boolean;
  /** Duration of the check in milliseconds (measured even on failure). */
  ms: number;
  /** Failure reason, bounded: a raw error message may carry a connection URL. */
  error?: string;
}

export interface ReadinessReport {
  ok: boolean;
  checks: Record<string, CheckResult>;
}

/** Usable failure reason, without disclosing credentials or topology. */
export function failureReason(err: unknown): string {
  if (err instanceof Error && err.message) return err.message.slice(0, 120);
  return 'unavailable';
}

/**
 * Runs a check under a maximum delay. The `timeout` does more than return control: without it, a dependency
 * that never answers (unreachable Redis, socket open but silent) would hang the monitoring request — the exact
 * failure mode of `GET /api/admin/system`.
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

/** Runs all checks in parallel: the probe lasts as long as the slowest, not their sum. */
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
 * Memorises the last report and groups concurrent calls. Two supervisors and a front proxy probing at the same
 * time trigger only one query of the dependencies.
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

/** The three dependencies without which the instance serves no useful purpose. */
export const dependencyProbes: Record<string, () => Promise<unknown>> = {
  database: () => prisma.$queryRaw`SELECT 1`,
  redis: () => getRedis().call('PING'),
  storage: async () => {
    if (!(await storage.ping())) throw new Error('bucket unreachable');
  },
};
