// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { getSourceUrl } from '../lib/settings';
import { appVersion } from '../lib/version';
import { isShuttingDown } from '../lib/gracefulShutdown';
import { createReadinessCache, dependencyProbes, runChecks, READY_CACHE_MS } from '../lib/health';
// Re-export: the mechanics moved to lib/health; the historical callers (tests, the system
// administration screen) still find it here.
export * from '../lib/health';

/**
 * Health probes and instance version.
 *
 * `GET /health` answered "ok" without touching anything: a backend whose connection pool had died stayed
 * "healthy" and kept receiving traffic. The two questions are therefore separated, as they do not have
 * the same answers:
 *
 *  - **liveness** (`/health`, `/health/live`): does the process answer? No I/O, never a failure on a
 *    dependency. This is the probe of `docker compose`, and restarting a container because Postgres went
 *    down would only add one outage to another;
 *  - **availability** (`/health/ready`): can the instance actually serve? The database, Redis and MinIO
 *    are queried, each under a maximum delay; any faulty dependency gives a **503**, which a front end or
 *    external supervision knows how to read.
 *
 * The availability probe is bounded in load by construction: each check has a delay, the result is
 * memoized for a few seconds, and concurrent calls share the same execution. Hammering `/health/ready`
 * therefore costs, at worst, one round trip per dependency every `READY_CACHE_MS`: otherwise the probe
 * would itself be the load vector that finishes off an instance already in difficulty.
 *
 * Public surface (no authentication): it therefore carries, like `/api/docs`, the offer of corresponding
 * source code required by AGPL §13. It is also the only way for a user to know *which* sources match the
 * instance they use.
 */
/** Liveness: no I/O, no dependency. Answers as long as the event loop is running. */
const liveness = (): Record<string, unknown> => ({
  status: 'ok',
  version: appVersion.version,
  commit: appVersion.commit,
  uptimeSec: Math.round(process.uptime()),
});

/**
 * Builds the health router. Parameterizable so that the tests can exercise the 503 without depending on
 * the memoized state of the real router (the cache is precisely shared by all calls: that is what we want
 * in production, not in a test suite).
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
    /*
     * A process that is shutting down is not ready, even if its dependencies still answer. The graceful
     * shutdown lets in-flight requests finish for a few seconds; without this check, the probe answers 200
     * for that whole delay and the front end keeps routing new traffic to a process that is emptying: each
     * request sent there arrives after the closing. This is exactly what `isShuttingDown` is for, which
     * existed without a caller: the draining was written server-side, but never announced outside.
     *
     * Before reading the dependencies: the state is certain and local, there is nothing to wait for to
     * know it.
     */
    if (isShuttingDown()) {
      res.status(503).json({
        status: 'shutting-down',
        version: appVersion.version,
        commit: appVersion.commit,
      });
      return;
    }
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
 * Instance version, public (`GET /api/version`): support, monitoring and the "About" screen of the
 * administration all read the same source. Publishing the version of an AGPL software is not a leak:
 * §13, on the contrary, requires being able to designate the *corresponding* sources, which the
 * version plus commit pair alone allows.
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
