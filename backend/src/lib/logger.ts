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

/**
 * Embellisseur de sortie — **seulement s'il est réellement là**.
 *
 * `pino-pretty` est une devDependency, et l'image d'exécution est construite avec
 * `npm ci --omit=dev` : elle ne l'embarque pas. Or la pile docker de développement pose
 * `NODE_ENV=development` sur cette même image (c'est ce qui désactive les garde-fous de
 * production : secrets forts, CORS strict). Les deux décisions sont bonnes séparément, et
 * leur rencontre faisait lever à pino « unable to determine transport target for
 * "pino-pretty" » **au chargement du module** : le conteneur ne démarrait pas du tout, et le
 * message ne parlait ni de docker ni de NODE_ENV.
 *
 * Un embellisseur de logs ne peut pas être la raison pour laquelle un processus refuse de
 * démarrer. On ne le demande donc que si le paquet est installé, et on retombe sinon sur le
 * JSON — qui est de toute façon ce qu'on veut dès qu'on agrège.
 */
export function prettyTransport(
  nodeEnv: string,
  isInstalled: (name: string) => boolean,
): LoggerOptions['transport'] | undefined {
  if (nodeEnv !== 'development' || !isInstalled('pino-pretty')) return undefined;
  return {
    target: 'pino-pretty',
    options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' },
  };
}

/** Le paquet est-il résolvable depuis ce module ? `require.resolve` ne l'exécute pas. */
const isInstalled = (name: string): boolean => {
  try {
    require.resolve(name);
    return true;
  } catch {
    return false;
  }
};

const transport = prettyTransport(env.NODE_ENV, isInstalled);

const options: LoggerOptions = {
  level,
  redact: { paths: REDACTED_FIELDS, censor: '[Redacted]' },
  ...(transport ? { transport } : {}),
};

export const logger = pino(options);
