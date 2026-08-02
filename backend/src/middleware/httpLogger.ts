// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { pinoHttp } from 'pino-http';
import { randomUUID } from 'node:crypto';
import { logger } from '../lib/logger';

/**
 * Journalisation HTTP structurée (pino-http) : une ligne JSON par requête avec
 * request-id, méthode, URL, statut et durée. Attache `req.log` (logger enfant
 * corrélé au request-id) réutilisable dans les handlers et le middleware d'erreur.
 */
export const httpLogger = pinoHttp({
  logger,
  // Réutilise un `x-request-id` fourni en amont (reverse proxy) sinon en génère un,
  // et le renvoie au client pour la corrélation bout-en-bout.
  genReqId: (req, res) => {
    const header = req.headers['x-request-id'];
    const id = (Array.isArray(header) ? header[0] : header) || randomUUID();
    res.setHeader('x-request-id', id);
    return id;
  },
  customLogLevel: (_req, res, err) => {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  // Ne jamais journaliser les secrets transitant en en-tête.
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
    remove: true,
  },
});
