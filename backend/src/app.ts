// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import './lib/bigintJson';
import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env';
import { secretEquals } from './lib/crypto';
import { enableRedisTransport } from './lib/redis';
import { rateLimit, identityRateKey, identityMax, __rateLimitTesting } from './middleware/rateLimit';
import { errorHandler } from './middleware/error';
import { httpLogger } from './middleware/httpLogger';
import { apiTokenSurface } from './middleware/scope';

import setupRoutes from './routes/setup.routes';
import authRoutes from './routes/auth.routes';
import authRefreshRoutes from './routes/auth-refresh.routes';
import authSecurityRoutes from './routes/auth-security.routes';
import webhooksRoutes from './routes/webhooks.routes';
import auth2faRoutes from './routes/auth-2fa.routes';
import jobsRoutes from './routes/jobs.routes';
import { httpMetrics, registry, startQueueMetrics } from './lib/metrics';
import authOidcRoutes from './routes/auth-oidc.routes';
import usersRoutes from './routes/users.routes';
import usersProfileRoutes from './routes/users-profile.routes';
import pushRoutes from './routes/push.routes';
import chatRoutes from './routes/chat.routes';
import studioRoutes from './routes/studio.routes';
import studioAppearanceRoutes from './routes/studio-appearance.routes';
import overviewLayoutRoutes from './routes/overview-layout.routes';
import studioSmtpRoutes from './routes/studio-smtp.routes';
import projectsRoutes from './routes/projects.routes';
import projectsExtraRoutes from './routes/projects-extra.routes';
import mediaRoutes from './routes/media.routes';
import mediaUploadRoutes from './routes/media-upload.routes';
import mediaSplatRoutes from './routes/media-splat.routes';
import mediaReferenceRoutes from './routes/media-reference.routes';
import mediaMarkersRoutes from './routes/media-markers.routes';
import mediaUsdRoutes from './routes/media-usd.routes';
import episodesRoutes from './routes/episodes.routes';
import sequencesRoutes from './routes/sequences.routes';
import shotsRoutes from './routes/shots.routes';
import assetsRoutes from './routes/assets.routes';
import tasksRoutes from './routes/tasks.routes';
import versionsRoutes from './routes/versions.routes';
import reviewStatusesRoutes from './routes/review-statuses.routes';
import pipelineStatusesRoutes from './routes/pipeline-statuses.routes';
import departmentsRoutes from './routes/departments.routes';
import entityThumbnailsRoutes from './routes/entity-thumbnails.routes';
import assignmentsRoutes from './routes/assignments.routes';
import entityExtrasRoutes from './routes/entity-extras.routes';
import noteImagesRoutes from './routes/note-images.routes';
import visibilityRoutes from './routes/visibility.routes';
import unsubscribeRoutes from './routes/unsubscribe.routes';
import commentsRoutes from './routes/comments.routes';
import boardsRoutes from './routes/boards.routes';
import shareRoutes from './routes/share.routes';
import clientRoutes from './routes/client.routes';
import adminRoutes from './routes/admin.routes';
import adminExplorerRoutes from './routes/admin-explorer.routes';
import notificationsRoutes from './routes/notifications.routes';
import favoritesRoutes from './routes/favorites.routes';
import contextRoutes from './routes/context.routes';
import searchRoutes from './routes/search.routes';
import dashboardRoutes from './routes/dashboard.routes';
import bulkRoutes from './routes/bulk.routes';
import hdriRoutes from './routes/hdri.routes';
import ocioRoutes from './routes/ocio.routes';
import announcementsRoutes from './routes/announcements.routes';
import docsRoutes from './routes/docs.routes';
import healthRoutes, { versionRouter } from './routes/health.routes';
import watchRoutes from './routes/watch.routes';
import visitsRoutes from './routes/visits.routes';
import playlistsRoutes from './routes/playlists.routes';
import timelinesRoutes from './routes/timelines.routes';
import liveRoutes from './routes/live.routes';
import productionRoutes from './routes/production.routes';
import serviceTokensRoutes from './routes/service-tokens.routes';
import adminOpsRoutes from './routes/admin-ops.routes';
import adminOpsRunsRoutes from './routes/admin-ops-runs.routes';
import v1Routes from './routes/v1';
import shotgridConfigRoutes from './routes/shotgrid-config.routes';
import shotgridSyncRoutes from './routes/shotgrid-sync.routes';
import shotgridWebhookRoutes from './routes/shotgrid-webhook.routes';
import shotgridEntityRoutes from './routes/shotgrid-entity.routes';
import shotgridCrewRoutes from './routes/shotgrid-crew.routes';

/**
 * Global rate limiter ceilings, per fifteen-minute window.
 *
 * The former single ceiling (5,000 per IP) was shared by a whole studio behind one NAT exit:
 * fifty people, about 5.5 requests per second to share, whereas merely opening a project costs
 * a dozen. This failure mode had already been observed: a simple test run saturated the counter.
 *
 * The authenticated account therefore has its own counter. The anonymous ceiling keeps its
 * original value: lowering it would silently tighten the public surfaces (client sharing,
 * login, documentation) this limiter really protects.
 */
const GLOBAL_MAX_PER_USER = 6_000;
const GLOBAL_MAX_PER_IP = 5_000;

export interface CreateAppOptions {
  /**
   * Rate limiters. `false` disables them — **reserved for integration tests**.
   *
   * An integration suite hits the same app hundreds of times from the same address within a few
   * seconds: it saturates its own counters and starts receiving 429s unrelated to what it checks.
   * This was the failure mode of the resumable upload test, red for weeks.
   *
   * The disabling covers two families of limiters:
   *  - those mounted here (global, /api/setup, client sharing, /api/v1), replaced by a
   *    pass-through;
   *  - those built at router import time (`auth.routes`, `comments`, `search`, `client`,
   *    `unsubscribe`, ShotGrid webhook), out of reach of an app option: they are neutralised
   *    through their counter, via the middleware's test hook.
   *
   * Guard: refused outside `NODE_ENV=test`. An option able to silently switch off the whole rate
   * limiter of a production instance would be a vulnerability, not a convenience.
   */
  rateLimit?: boolean;
}

/** A counter that does not count: every hit returns the first value, so the limit is never exceeded. */
const unlimitedCounter = () => ({ hit: () => Promise.resolve(1) });

export const createApp = (options: CreateAppOptions = {}): Express => {
  const limitersOff = options.rateLimit === false;
  if (limitersOff && env.NODE_ENV !== 'test') {
    throw new Error('createApp({ rateLimit: false }) is reserved for NODE_ENV=test');
  }
  // Pass-through for the limiters mounted here; the others go through their own counter.
  const limiter: typeof rateLimit = limitersOff
    ? () => (_req, _res, next) => {
        next();
      }
    : rateLimit;
  if (limitersOff) __rateLimitTesting.setCounterFactory(unlimitedCounter);

  const app = express();

  // The limiter, presence and live rooms talk to Redis: the transport is armed here rather than
  // at import time, so that a unit test never opens a connection.
  enableRedisTransport();

  // Trust granted to `X-Forwarded-For`: explicit, and none by default. This header is supplied by
  // the caller as soon as the backend port is reachable without a proxy in front, and it serves as
  // the key of ALL limiters (middleware/rateLimit) as well as the address in audit lines.
  // See the TRUST_PROXY comment in config/env.ts.
  app.set('trust proxy', env.TRUST_PROXY);
  // Structured HTTP logging as early as possible (request-id on every response).
  app.use(httpLogger);
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  app.use(cors({ origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN.split(',') }));

  // ShotGrid (48): mounted before the JSON parser. The HMAC signature covers the bytes received,
  // and a body already parsed then re-serialised does not reproduce them.
  app.use('/api/shotgrid/webhook', shotgridWebhookRoutes);

  /*
   * Splat edits: the only large body in the API.
   *
   * The deletion mask is a base64 bitset (deleting one splat in two out of a scan of fifteen
   * million points makes several megabytes), and subset transforms likewise send their indices
   * in binary. Both routes declare `z.string().max(5_400_000)` with the comment "about 4 MB binary
   * max", but the global 2 MB ceiling rejected the request with a 413 **before** Zod saw it: the
   * announced ceiling was unreachable, and the editor silently lost the artist's work.
   *
   * Placed before the global parser: `express.json` parses only once, the first one wins.
   */
  const splatBodyJson = express.json({ limit: '8mb' });
  app.use((req, res, next) =>
    /^\/api\/media\/\d+\/splat-(mask|subset)$/.test(req.path) ? splatBodyJson(req, res, next) : next(),
  );

  // Everywhere else, files transit through MinIO via presigned URLs: no large body.
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));

  // Prometheus metrics (37.G): HTTP histogram + BullMQ gauges.
  app.use(httpMetrics);
  startQueueMetrics();
  app.get('/metrics', async (req, res) => {
    // Optional token: without METRICS_TOKEN the endpoint must be reserved for the internal network
    // (the front nginx does not expose it). With one, require ?token= or a Bearer header.
    if (env.METRICS_TOKEN) {
      const provided =
        (typeof req.query.token === 'string' ? req.query.token : undefined) ??
        req.headers.authorization?.split(' ')[1];
      if (!secretEquals(provided, env.METRICS_TOKEN)) {
        res.status(401).end();
        return;
      }
    }
    res.setHeader('Content-Type', registry.contentType);
    res.end(await registry.metrics());
  });

  // Global rate limit: keyed by authenticated account, falling back to IP for anonymous requests.
  app.use(
    '/api',
    limiter({
      name: 'global',
      windowMs: 15 * 60 * 1000,
      keyGenerator: identityRateKey,
      max: identityMax(GLOBAL_MAX_PER_USER, GLOBAL_MAX_PER_IP),
    }),
  );

  // API token surface: a `rvk_…` token only opens the integration API `/api/v1`.
  //
  // Set here, before any business router, rather than route by route: this is the only place that
  // is not forgotten when adding a domain. Without it, `middleware/auth` accepted an API token on
  // any internal API route, and the per-project scoping sold by the tokens screen only applied to
  // `/api/v1`.
  app.use('/api', apiTokenSurface);

  // Health probes and version (liveness `/health`, readiness `/health/ready`).
  //
  // Mounted TWICE on purpose: the production front nginx only proxies to the backend `/api/`,
  // `/socket.io/` and `/review/`. So `GET /health` was served by the SPA (200 HTML, "all good"
  // whatever the API state) and `/api/health` did not exist. The container probe queries `/health`
  // directly.
  app.use('/health', healthRoutes);
  app.use('/api/health', healthRoutes);
  app.use('/api/version', versionRouter);

  // Domain routes
  // First-installation assistant: public by nature (no account exists yet), and it creates the first
  // ADMIN. The global 5000/15 min ceiling does not protect it: it is tightly bounded per IP instead.
  // The background lock remains `studio.count() > 0`.
  // `GET /status` is queried at application start, hence on every page load: counting it in the
  // installation ceiling triggered a 429 from the 11th reload within a quarter of an hour. The
  // front end caught it (fallback "nothing to install"), but on a new instance it made the assistant
  // unreachable for fifteen minutes.
  // It reads nothing sensitive: a generous ceiling is enough, and the tight ceiling stays on
  // everything else, that is, on the creation of the first ADMIN.
  const setupWriteLimiter = limiter({ name: 'setup', windowMs: 15 * 60 * 1000, max: 10 });
  app.use(
    '/api/setup',
    limiter({ name: 'setup-status', windowMs: 60 * 1000, max: 120 }),
    (req, res, next) => (req.path === '/status' ? next() : setupWriteLimiter(req, res, next)),
    setupRoutes,
  );
  app.use('/api/auth/refresh', authRefreshRoutes); // refresh cookie: renew + logout
  app.use('/api/auth', authRoutes);
  app.use('/api/auth/2fa', auth2faRoutes); // 2FA TOTP (36.A)
  app.use('/api/auth/oidc', authOidcRoutes); // SSO OIDC (36.A)
  app.use('/api/auth', authSecurityRoutes); // sessions + tokens API (36.B/36.C)
  app.use('/api/users', usersProfileRoutes); // member profile + avatar — before /:id
  app.use('/api/users', usersRoutes);
  app.use('/api/push', pushRoutes); // Web Push (42.B №66)
  app.use('/api/chat', chatRoutes); // internal messaging (DMs & groups)
  app.use('/api/studio', studioRoutes);
  app.use('/api/studio', studioAppearanceRoutes);
  app.use('/api/studio', overviewLayoutRoutes); // default layouts of the overview (50.10)
  app.use('/api/studio', studioSmtpRoutes);
  app.use('/api/studio/hdris', hdriRoutes);
  app.use('/api/studio/ocio', ocioRoutes);
  app.use('/api/projects', projectsExtraRoutes); // usage/quotas + duplicate (38) — before /:id
  app.use('/api/projects', productionRoutes); // stats & planning (Phase 43) — sub-routes /:projectId
  app.use('/api/projects', projectsRoutes);
  app.use('/api/media', mediaUploadRoutes); // resumable multipart (37.A) — before /:id
  app.use('/api/media', mediaRoutes);
  app.use('/api/media', mediaSplatRoutes); // splat edits (10.G)
  app.use('/api/media', mediaReferenceRoutes); // 2D review reference image (Phase 24)
  app.use('/api/media', mediaMarkersRoutes); // shared timeline markers (Phase 34.C)
  app.use('/api/media', mediaUsdRoutes); // USD scene recomposition (Phase 45.E)
  // Episode level (optional per project, off by default): the router itself refuses when the
  // setting is off.
  app.use('/api/episodes', episodesRoutes);
  app.use('/api/sequences', sequencesRoutes);
  app.use('/api/shots', shotsRoutes);
  app.use('/api/assets', assetsRoutes);
  app.use('/api/tasks', tasksRoutes);
  app.use('/api/versions', versionsRoutes);
  app.use('/api/review-statuses', reviewStatusesRoutes); // custom review statuses (Phase 31)
  app.use('/api/pipeline-statuses', pipelineStatusesRoutes); // task/plan statuses (Phase 48)
  // Departments (B1): the router serves several prefixes (projects, entities, accounts), so it is
  // mounted at the root of /api rather than under a single segment.
  app.use('/api', departmentsRoutes);
  // Entity thumbnails (C3): same reason, the router serves sequences, plans and assets.
  app.use('/api', entityThumbnailsRoutes);
  // Assignment (assets and plans): same root mounting, two prefixes.
  app.use('/api', assignmentsRoutes);
  // Responsible persons and markdown sheet of an entity: four prefixes, also at the root.
  app.use('/api', entityExtrasRoutes);
  // Images attached to a sheet: per-entity upload, batch key lookup.
  app.use('/api', noteImagesRoutes);
  // Element hiding (admin).
  app.use('/api', visibilityRoutes);
  // ShotGrid (48): webhook reception is mounted earlier (raw body).
  app.use('/api/shotgrid', shotgridConfigRoutes);
  app.use('/api/shotgrid', shotgridSyncRoutes);
  app.use('/api/shotgrid', shotgridEntityRoutes);
  app.use('/api/shotgrid', shotgridCrewRoutes);
  app.use('/api/comments', commentsRoutes);
  app.use('/api/boards', boardsRoutes);
  // Client sharing (public access by link/token): rate limit tightened per IP (10.D5).
  const shareLimiter = limiter({
    name: 'share',
    windowMs: 15 * 60 * 1000,
    max: 300,
    message: { error: 'Too many requests on this share, try again later.' },
  });
  app.use('/api/share', shareLimiter, shareRoutes);
  app.use('/api/client', shareLimiter, clientRoutes);
  // Unsubscribe from recurring mailings: public by nature. The native button of mail clients calls
  // it without a session, often from the provider's servers.
  app.use('/api/unsubscribe', unsubscribeRoutes);
  app.use('/api/admin/webhooks', webhooksRoutes); // outgoing webhooks (36.D)
  app.use('/api/admin/service-tokens', serviceTokensRoutes); // machine identities (API v1)
  app.use('/api/admin/jobs', jobsRoutes); // dashboard BullMQ (37.C)
  app.use('/api/admin/ops', adminOpsRunsRoutes); // command and tracking of an operation (49)
  app.use('/api/admin/ops', adminOpsRoutes); // running version, releases, backups (49)
  app.use('/api/admin', adminExplorerRoutes); // detailed entity records (admin rework)
  app.use('/api/admin', adminRoutes);
  app.use('/api/notifications', notificationsRoutes);
  app.use('/api/favorites', favoritesRoutes);
  app.use('/api/context', contextRoutes);
  app.use('/api/search', searchRoutes);
  app.use('/api/dashboard', dashboardRoutes);
  app.use('/api/announcements', announcementsRoutes);
  app.use('/api/bulk', bulkRoutes);
  app.use('/api/watch', watchRoutes);
  app.use('/api/visits', visitsRoutes); // "not viewed" acknowledgement (Phase 50, batch 9)
  app.use('/api/playlists', playlistsRoutes); // dailies (Phase 33)
  app.use('/api/timelines', timelinesRoutes); // automatic edits (Phase 45)
  app.use('/api/live', liveRoutes); // ongoing live sessions (LIVE badges)
  // Integration API v1 (DCC, Prism, bots): stable contract, distinct from the internal API.
  // Its own ceiling: a daemon polling the event log in a loop must not consume the interface
  // users' quota.
  app.use('/api/v1', limiter({ name: 'v1', windowMs: 15 * 60 * 1000, max: 10_000 }), v1Routes);

  // OpenAPI documentation (public): /api/openapi.json + /api/docs (Scalar)
  app.use('/api', docsRoutes);

  // Global error handler (always last)
  app.use(errorHandler);

  return app;
};
