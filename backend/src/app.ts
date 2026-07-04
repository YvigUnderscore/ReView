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
import usersRoutes from './routes/users.routes';
import studioRoutes from './routes/studio.routes';
import projectsRoutes from './routes/projects.routes';
import mediaRoutes from './routes/media.routes';
import sequencesRoutes from './routes/sequences.routes';
import shotsRoutes from './routes/shots.routes';
import assetsRoutes from './routes/assets.routes';
import tasksRoutes from './routes/tasks.routes';
import versionsRoutes from './routes/versions.routes';
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

  // Rate limit global
  app.use('/api', rateLimit({ windowMs: 15 * 60 * 1000, max: 5000 }));

  // Health check
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Routes par domaine
  app.use('/api/setup', setupRoutes);
  app.use('/api/auth', authRoutes);
  app.use('/api/users', usersRoutes);
  app.use('/api/studio', studioRoutes);
  app.use('/api/projects', projectsRoutes);
  app.use('/api/media', mediaRoutes);
  app.use('/api/sequences', sequencesRoutes);
  app.use('/api/shots', shotsRoutes);
  app.use('/api/assets', assetsRoutes);
  app.use('/api/tasks', tasksRoutes);
  app.use('/api/versions', versionsRoutes);
  app.use('/api/comments', commentsRoutes);
  app.use('/api/boards', boardsRoutes);
  app.use('/api/share', shareRoutes);
  app.use('/api/client', clientRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/notifications', notificationsRoutes);
  app.use('/api/favorites', favoritesRoutes);
  app.use('/api/documents', documentsRoutes);
  app.use('/api/context', contextRoutes);
  app.use('/api/search', searchRoutes);

  // Gestionnaire d'erreurs global (toujours en dernier)
  app.use(errorHandler);

  return app;
};
