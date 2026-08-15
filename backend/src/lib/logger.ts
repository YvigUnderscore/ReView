// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import pino, { type LoggerOptions } from 'pino';
import { env } from '../config/env';

/**
 * Logger structuré unique de l'application (backend + workers).
 *
 * - Niveau : `LOG_LEVEL` explicite, sinon dérivé de `NODE_ENV`
 *   (`silent` en test, `info` en production, `debug` en développement).
 * - Sortie : JSON une ligne par événement (agrégation/observabilité), sauf en
 *   développement où `pino-pretty` colorise pour la lisibilité locale.
 * - Le request-id et la journalisation des requêtes HTTP sont ajoutés par
 *   `pino-http` (cf. `middleware/httpLogger`).
 */
const level =
  env.LOG_LEVEL ?? (env.NODE_ENV === 'test' ? 'silent' : env.NODE_ENV === 'production' ? 'info' : 'debug');

/**
 * Champs jamais journalisés, où qu'ils apparaissent dans l'objet passé au logger.
 *
 * La rédaction du journal HTTP couvre les en-têtes ; celle-ci couvre le reste — un
 * enregistrement de site ShotGrid, un formulaire SMTP, une entité relue depuis la base.
 * Un secret n'a aucune raison d'atteindre un fichier de log, et l'oubli se produit au
 * moment où l'on ajoute un `logger.error({ site })` pour déboguer.
 */
const REDACTED_FIELDS = [
  'password',
  '*.password',
  '*.*.password',
  'scriptKey',
  '*.scriptKey',
  '*.*.scriptKey',
  'webhookSecret',
  '*.webhookSecret',
  'secret',
  '*.secret',
  'apiKey',
  '*.apiKey',
  'accessToken',
  '*.accessToken',
  'access_token',
  '*.access_token',
];

const options: LoggerOptions = {
  level,
  redact: { paths: REDACTED_FIELDS, censor: '[Redacted]' },
  // pino-pretty n'est chargé qu'en développement (devDependency) : la prod reste en JSON pur.
  ...(env.NODE_ENV === 'development'
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' },
        },
      }
    : {}),
};

export const logger = pino(options);
