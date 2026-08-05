// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { pinoHttp } from 'pino-http';
import { stdSerializers } from 'pino';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { logger } from '../lib/logger';

/** `?token=…` / `?access_token=…` dans une URL journalisée (groupe 1 = le nom + `=`). */
const TOKEN_IN_URL = /([?&](?:token|access_token)=)[^&]*/gi;

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
  // `middleware/auth` accepte aussi un jeton en query (`?token=`), tout comme /metrics :
  // sans ce masquage il atterrirait en clair dans `req.url`, donc dans les journaux —
  // là où la redaction des en-têtes ne le protège pas. On enveloppe le sérialiseur
  // standard (surtout pas de passthrough : il exposerait l'objet requête entier).
  serializers: {
    req(req: IncomingMessage) {
      const serialized = stdSerializers.req(req);
      // Garde bon marché en `includes` : `RegExp.test` sur une regex /g est capricieux
      // (il déplace `lastIndex` d'un appel à l'autre).
      if (typeof serialized.url === 'string' && serialized.url.includes('token=')) {
        serialized.url = serialized.url.replace(TOKEN_IN_URL, '$1[Redacted]');
      }
      return serialized;
    },
  },
});
