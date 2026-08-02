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

const options: LoggerOptions = {
  level,
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
