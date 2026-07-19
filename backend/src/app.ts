import './lib/bigintJson';
import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env';
import { rateLimit } from './middleware/rateLimit';
import { errorHandler } from './middleware/error';
import { httpLogger } from './middleware/httpLogger';

import setupRoutes from './routes/setup.routes';
import authRoutes from './routes/auth.routes';
import authSecurityRoutes from './routes/auth-security.routes';
import webhooksRoutes from './routes/webhooks.routes';
import auth2faRoutes from './routes/auth-2fa.routes';
import jobsRoutes from './routes/jobs.routes';
import { httpMetrics, registry, startQueueMetrics } from './lib/metrics';
import authOidcRoutes from './routes/auth-oidc.routes';
import usersRoutes from './routes/users.routes';
import studioRoutes from './routes/studio.routes';
import projectsRoutes from './routes/projects.routes';
import mediaRoutes from './routes/media.routes';
import mediaUploadRoutes from './routes/media-upload.routes';
import mediaSplatRoutes from './routes/media-splat.routes';
import mediaVideoRoutes from './routes/media-video.routes';
import mediaReferenceRoutes from './routes/media-reference.routes';
import mediaMarkersRoutes from './routes/media-markers.routes';
import sequencesRoutes from './routes/sequences.routes';
import shotsRoutes from './routes/shots.routes';
import assetsRoutes from './routes/assets.routes';
import tasksRoutes from './routes/tasks.routes';
import versionsRoutes from './routes/versions.routes';
import reviewStatusesRoutes from './routes/review-statuses.routes';
import commentsRoutes from './routes/comments.routes';
import boardsRoutes from './routes/boards.routes';
import shareRoutes from './routes/share.routes';
import clientRoutes from './routes/client.routes';
import adminRoutes from './routes/admin.routes';
import notificationsRoutes from './routes/notifications.routes';
import favoritesRoutes from './routes/favorites.routes';
import documentsRoutes from './routes/documents.routes';
import contextRoutes from './routes/context.routes';
import searchRoutes from './routes/search.routes';
import dashboardRoutes from './routes/dashboard.routes';
import bulkRoutes from './routes/bulk.routes';
import hdriRoutes from './routes/hdri.routes';
import announcementsRoutes from './routes/announcements.routes';
import docsRoutes from './routes/docs.routes';
import watchRoutes from './routes/watch.routes';
import playlistsRoutes from './routes/playlists.routes';
import liveRoutes from './routes/live.routes';

export const createApp = (): Express => {
  const app = express();

  app.set('trust proxy', 1);
  // Journalisation HTTP structurée le plus tôt possible (request-id sur toutes les réponses).
  app.use(httpLogger);
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  app.use(cors({ origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN.split(',') }));

  // En v2 les fichiers transitent par MinIO via URLs présignées : pas de gros body.
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));

  // Métriques Prometheus (37.G) : histogramme HTTP + gauges BullMQ.
  app.use(httpMetrics);
  startQueueMetrics();
  app.get('/metrics', async (req, res) => {
    // Jeton optionnel : sans METRICS_TOKEN, l'endpoint est à réserver au réseau interne
    // (le nginx frontal ne l'expose pas). Avec, exiger ?token= ou Bearer.
    if (env.METRICS_TOKEN) {
      const provided =
        (typeof req.query.token === 'string' ? req.query.token : undefined) ??
        req.headers.authorization?.split(' ')[1];
      if (provided !== env.METRICS_TOKEN) {
        res.status(401).end();
        return;
      }
    }
    res.setHeader('Content-Type', registry.contentType);
    res.end(await registry.metrics());
  });

  // Rate limit global
  app.use('/api', rateLimit({ windowMs: 15 * 60 * 1000, max: 5000 }));

  // Health check
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Routes par domaine
  app.use('/api/setup', setupRoutes);
  app.use('/api/auth', authRoutes);
  app.use('/api/auth/2fa', auth2faRoutes); // 2FA TOTP (36.A)
  app.use('/api/auth/oidc', authOidcRoutes); // SSO OIDC (36.A)
  app.use('/api/auth', authSecurityRoutes); // sessions + tokens API (36.B/36.C)
  app.use('/api/users', usersRoutes);
  app.use('/api/studio', studioRoutes);
  app.use('/api/studio/hdris', hdriRoutes);
  app.use('/api/projects', projectsRoutes);
  app.use('/api/media', mediaUploadRoutes); // multipart résumable (37.A) — avant /:id
  app.use('/api/media', mediaRoutes);
  app.use('/api/media', mediaSplatRoutes); // éditions splat (10.G)
  app.use('/api/media', mediaVideoRoutes); // trim vidéo non-destructif (10.G-V10)
  app.use('/api/media', mediaReferenceRoutes); // image de référence review 2D (Phase 24)
  app.use('/api/media', mediaMarkersRoutes); // marqueurs de timeline partagés (Phase 34.C)
  app.use('/api/sequences', sequencesRoutes);
  app.use('/api/shots', shotsRoutes);
  app.use('/api/assets', assetsRoutes);
  app.use('/api/tasks', tasksRoutes);
  app.use('/api/versions', versionsRoutes);
  app.use('/api/review-statuses', reviewStatusesRoutes); // statuts de review custom (Phase 31)
  app.use('/api/comments', commentsRoutes);
  app.use('/api/boards', boardsRoutes);
  // Partage client (accès public par lien/token) : rate limit renforcé par IP (10.D5).
  const shareLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    message: { error: 'Trop de requêtes sur le partage, réessayez plus tard.' },
  });
  app.use('/api/share', shareLimiter, shareRoutes);
  app.use('/api/client', shareLimiter, clientRoutes);
  app.use('/api/admin/webhooks', webhooksRoutes); // webhooks sortants (36.D)
  app.use('/api/admin/jobs', jobsRoutes); // dashboard BullMQ (37.C)
  app.use('/api/admin', adminRoutes);
  app.use('/api/notifications', notificationsRoutes);
  app.use('/api/favorites', favoritesRoutes);
  app.use('/api/documents', documentsRoutes);
  app.use('/api/context', contextRoutes);
  app.use('/api/search', searchRoutes);
  app.use('/api/dashboard', dashboardRoutes);
  app.use('/api/announcements', announcementsRoutes);
  app.use('/api/bulk', bulkRoutes);
  app.use('/api/watch', watchRoutes);
  app.use('/api/playlists', playlistsRoutes); // dailies (Phase 33)
  app.use('/api/live', liveRoutes); // sessions live en cours (badges LIVE)
  // Documentation OpenAPI (publique) : /api/openapi.json + /api/docs (Scalar)
  app.use('/api', docsRoutes);

  // Gestionnaire d'erreurs global (toujours en dernier)
  app.use(errorHandler);

  return app;
};
