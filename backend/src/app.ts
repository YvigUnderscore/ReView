// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import './lib/bigintJson';
import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env';
import { secretEquals } from './lib/crypto';
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
import usersProfileRoutes from './routes/users-profile.routes';
import pushRoutes from './routes/push.routes';
import chatRoutes from './routes/chat.routes';
import studioRoutes from './routes/studio.routes';
import studioAppearanceRoutes from './routes/studio-appearance.routes';
import studioSmtpRoutes from './routes/studio-smtp.routes';
import projectsRoutes from './routes/projects.routes';
import projectsExtraRoutes from './routes/projects-extra.routes';
import mediaRoutes from './routes/media.routes';
import mediaUploadRoutes from './routes/media-upload.routes';
import mediaSplatRoutes from './routes/media-splat.routes';
import mediaVideoRoutes from './routes/media-video.routes';
import mediaReferenceRoutes from './routes/media-reference.routes';
import mediaMarkersRoutes from './routes/media-markers.routes';
import mediaUsdRoutes from './routes/media-usd.routes';
import sequencesRoutes from './routes/sequences.routes';
import shotsRoutes from './routes/shots.routes';
import assetsRoutes from './routes/assets.routes';
import tasksRoutes from './routes/tasks.routes';
import versionsRoutes from './routes/versions.routes';
import reviewStatusesRoutes from './routes/review-statuses.routes';
import pipelineStatusesRoutes from './routes/pipeline-statuses.routes';
import departmentsRoutes from './routes/departments.routes';
import entityThumbnailsRoutes from './routes/entity-thumbnails.routes';
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
import watchRoutes from './routes/watch.routes';
import playlistsRoutes from './routes/playlists.routes';
import timelinesRoutes from './routes/timelines.routes';
import liveRoutes from './routes/live.routes';
import productionRoutes from './routes/production.routes';
import serviceTokensRoutes from './routes/service-tokens.routes';
import v1Routes from './routes/v1';
import shotgridConfigRoutes from './routes/shotgrid-config.routes';
import shotgridSyncRoutes from './routes/shotgrid-sync.routes';
import shotgridWebhookRoutes from './routes/shotgrid-webhook.routes';
import shotgridEntityRoutes from './routes/shotgrid-entity.routes';

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

  // ShotGrid (48) — monté avant le parseur JSON : la signature HMAC porte sur les
  // octets reçus, et un corps déjà reparsé puis re-sérialisé ne redonne pas les mêmes.
  app.use('/api/shotgrid/webhook', shotgridWebhookRoutes);

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
      if (!secretEquals(provided, env.METRICS_TOKEN)) {
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
  // Assistant de première installation : public par nature (il n'existe encore aucun
  // compte), et il crée le premier ADMIN. Le plafond global de 5000/15 min ne le protège
  // pas — on le borne étroitement, par IP. Le verrou de fond reste `studio.count() > 0`.
  app.use('/api/setup', rateLimit({ windowMs: 15 * 60 * 1000, max: 10 }), setupRoutes);
  app.use('/api/auth', authRoutes);
  app.use('/api/auth/2fa', auth2faRoutes); // 2FA TOTP (36.A)
  app.use('/api/auth/oidc', authOidcRoutes); // SSO OIDC (36.A)
  app.use('/api/auth', authSecurityRoutes); // sessions + tokens API (36.B/36.C)
  app.use('/api/users', usersProfileRoutes); // fiche d'un membre + avatar — avant /:id
  app.use('/api/users', usersRoutes);
  app.use('/api/push', pushRoutes); // Web Push (42.B №66)
  app.use('/api/chat', chatRoutes); // messagerie interne (MP & groupes)
  app.use('/api/studio', studioRoutes);
  app.use('/api/studio', studioAppearanceRoutes);
  app.use('/api/studio', studioSmtpRoutes);
  app.use('/api/studio/hdris', hdriRoutes);
  app.use('/api/studio/ocio', ocioRoutes);
  app.use('/api/projects', projectsExtraRoutes); // usage/quotas + duplicate (38) — avant /:id
  app.use('/api/projects', productionRoutes); // stats & planning (Phase 43) — sous-routes /:projectId
  app.use('/api/projects', projectsRoutes);
  app.use('/api/media', mediaUploadRoutes); // multipart résumable (37.A) — avant /:id
  app.use('/api/media', mediaRoutes);
  app.use('/api/media', mediaSplatRoutes); // éditions splat (10.G)
  app.use('/api/media', mediaVideoRoutes); // trim vidéo non-destructif (10.G-V10)
  app.use('/api/media', mediaReferenceRoutes); // image de référence review 2D (Phase 24)
  app.use('/api/media', mediaMarkersRoutes); // marqueurs de timeline partagés (Phase 34.C)
  app.use('/api/media', mediaUsdRoutes); // recomposition d'une scène USD (Phase 45.E)
  app.use('/api/sequences', sequencesRoutes);
  app.use('/api/shots', shotsRoutes);
  app.use('/api/assets', assetsRoutes);
  app.use('/api/tasks', tasksRoutes);
  app.use('/api/versions', versionsRoutes);
  app.use('/api/review-statuses', reviewStatusesRoutes); // statuts de review custom (Phase 31)
  app.use('/api/pipeline-statuses', pipelineStatusesRoutes); // statuts de tâche/plan (Phase 48)
  // Départements (B1) : le routeur porte plusieurs préfixes (projets, entités, comptes),
  // il est donc monté à la racine de /api plutôt que sous un segment unique.
  app.use('/api', departmentsRoutes);
  // Vignettes d'entité (C3) : même raison, le routeur sert séquences, plans et assets.
  app.use('/api', entityThumbnailsRoutes);
  // ShotGrid (48) — la réception des webhooks est montée plus haut (corps brut).
  app.use('/api/shotgrid', shotgridConfigRoutes);
  app.use('/api/shotgrid', shotgridSyncRoutes);
  app.use('/api/shotgrid', shotgridEntityRoutes);
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
  app.use('/api/admin/service-tokens', serviceTokensRoutes); // identités machine (API v1)
  app.use('/api/admin/jobs', jobsRoutes); // dashboard BullMQ (37.C)
  app.use('/api/admin', adminExplorerRoutes); // fiches détaillées par entité (refonte admin)
  app.use('/api/admin', adminRoutes);
  app.use('/api/notifications', notificationsRoutes);
  app.use('/api/favorites', favoritesRoutes);
  app.use('/api/context', contextRoutes);
  app.use('/api/search', searchRoutes);
  app.use('/api/dashboard', dashboardRoutes);
  app.use('/api/announcements', announcementsRoutes);
  app.use('/api/bulk', bulkRoutes);
  app.use('/api/watch', watchRoutes);
  app.use('/api/playlists', playlistsRoutes); // dailies (Phase 33)
  app.use('/api/timelines', timelinesRoutes); // montages automatiques (Phase 45)
  app.use('/api/live', liveRoutes); // sessions live en cours (badges LIVE)
  // API d'intégration v1 (DCC, Prism, bots) — contrat stable, distinct de l'API interne.
  // Plafond propre : un daemon qui interroge le journal d'événements en boucle ne doit pas
  // consommer le quota des utilisateurs de l'interface.
  app.use('/api/v1', rateLimit({ windowMs: 15 * 60 * 1000, max: 10_000 }), v1Routes);

  // Documentation OpenAPI (publique) : /api/openapi.json + /api/docs (Scalar)
  app.use('/api', docsRoutes);

  // Gestionnaire d'erreurs global (toujours en dernier)
  app.use(errorHandler);

  return app;
};
