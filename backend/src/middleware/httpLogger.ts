// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { pinoHttp, type Options } from 'pino-http';
import { stdSerializers } from 'pino';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { logger } from '../lib/logger';

/** Marqueur posé à la place d'un secret — même forme que la redaction native de pino. */
const REDACTED = '[Redacted]';

/**
 * Jetons portés par le CHEMIN, et non par la query : quatre surfaces publiques
 * s'identifient par un segment d'URL qui EST le secret.
 *
 * - `/api/shotgrid/webhook/<jeton>` — droit d'écrire de faux événements ;
 * - `/api/auth/invitation/<jeton>` — pose un mot de passe et ouvre une session (7 j) ;
 * - `/api/client/<jeton>` — accès invité au partage d'un projet ;
 * - `/api/unsubscribe/<jeton>` — éteint une préférence d'envoi.
 *
 * Sans ce masquage, quiconque lit les journaux applicatifs prend le compte avant son
 * destinataire : c'est le même réflexe que pour un en-tête d'autorisation.
 *
 * `/api/share/<id>` n'y figure pas volontairement : son segment est l'identifiant
 * numérique d'un lien, pas son jeton — le masquer ne retirerait aucun secret et
 * priverait le journal de la seule information utile au diagnostic.
 */
const TOKEN_IN_PATH = /^(\/api\/(?:shotgrid\/webhook|auth\/invitation|client|unsubscribe)\/)[^/?#]+/i;

/**
 * Noms de paramètres de query dont la VALEUR est un secret. On raisonne par nom plutôt
 * que par liste close : le paramètre inventé demain (`sessionToken`, `apiKey`…) est ainsi
 * masqué d'office, quitte à masquer de temps en temps une valeur anodine.
 */
const SECRET_PARAM_SUBSTRING = /token|secret|password|passwd|signature|credential|key|auth/i;

/** Noms courts qu'aucune sous-chaîne ne rattrape (`?code=` du retour OIDC, par exemple). */
const SECRET_PARAM_EXACT = new Set(['code', 'state', 'sig', 'jwt', 'pwd', 'otp']);

function isSecretParam(rawName: string): boolean {
  let name = rawName;
  try {
    name = decodeURIComponent(rawName);
  } catch {
    // Nom mal encodé : on juge la forme brute plutôt que d'abandonner le masquage.
  }
  return SECRET_PARAM_SUBSTRING.test(name) || SECRET_PARAM_EXACT.has(name.toLowerCase());
}

/** Remplace la valeur des paramètres sensibles, en conservant les autres tels quels. */
function redactQuery(query: string): string {
  return query
    .split('&')
    .map((pair) => {
      const eq = pair.indexOf('=');
      if (eq < 0) return pair;
      const name = pair.slice(0, eq);
      return isSecretParam(name) ? `${name}=${REDACTED}` : pair;
    })
    .join('&');
}

/**
 * URL journalisable : chemin et query débarrassés de tout jeton.
 *
 * Exportée pour être testée — c'est la seule barrière entre un secret à usage unique et
 * un fichier de journal conservé des mois.
 */
export function redactUrl(url: string): string {
  const qi = url.indexOf('?');
  const path = (qi < 0 ? url : url.slice(0, qi)).replace(TOKEN_IN_PATH, `$1${REDACTED}`);
  if (qi < 0) return path;
  return `${path}?${redactQuery(url.slice(qi + 1))}`;
}

/**
 * Chemins des sondes automatiques : vivacité/disponibilité du conteneur et collecte
 * Prometheus, montés hors `/api` comme sous `/api` (app.ts monte `healthRoutes` aux deux).
 *
 * Le healthcheck docker interroge `/health` toutes les 10 s et Prometheus `/metrics`
 * toutes les 15 s : ~14 400 lignes par jour qui ne portent aucune information de
 * diagnostic, imputées sur les 50 Mo de rotation docker. `/health/ready` y figure parce
 * que le compose prévoit explicitement de l'utiliser comme sonde (HEALTH_PATH).
 */
const PROBE_PATHS = new Set([
  '/health',
  '/health/live',
  '/health/ready',
  '/api/health',
  '/api/health/live',
  '/api/health/ready',
  '/metrics',
]);

/**
 * La requête est-elle une sonde automatique ?
 *
 * On compare le CHEMIN seul : Prometheus ajoute `?token=…` quand METRICS_TOKEN est posé,
 * et une comparaison sur l'URL entière laisserait alors passer tout le bruit. La barre
 * oblique finale est tolérée (`/health/` est la même route côté Express).
 */
export function isProbeRequest(url: string | undefined): boolean {
  if (!url) return false;
  const cut = url.search(/[?#]/);
  const path = cut < 0 ? url : url.slice(0, cut);
  return PROBE_PATHS.has(path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path);
}

/**
 * Options de journalisation HTTP, exportées SANS le logger de l'application.
 *
 * Le logger réel est `silent` en environnement de test : compter des lignes à travers lui
 * ne prouverait rien. La suite recrée donc un `pinoHttp` avec ces mêmes options et un flux
 * qu'elle peut lire — c'est la configuration de production qui est mesurée, pas une copie.
 */
export const httpLoggerOptions: Options = {
  // Réutilise un `x-request-id` fourni en amont (reverse proxy) sinon en génère un,
  // et le renvoie au client pour la corrélation bout-en-bout.
  genReqId: (req, res) => {
    const header = req.headers['x-request-id'];
    const id = (Array.isArray(header) ? header[0] : header) || randomUUID();
    res.setHeader('x-request-id', id);
    return id;
  },
  customLogLevel: (req, res, err) => {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    // Sonde aboutie : rien à en dire. Le silence est posé ICI et non dans
    // `autoLogging.ignore`, qui retire les écouteurs de réponse et emporterait donc AUSSI
    // l'échec de la sonde (pino-http/logger.js : `shouldLogSuccess` conditionne
    // `res.on('finish', …)`). Or l'échec d'un healthcheck est précisément ce qu'un
    // exploitant vient chercher dans le journal — il reste journalisé par les deux
    // lignes ci-dessus.
    if (isProbeRequest(req.url)) return 'silent';
    return 'info';
  },
  // Ne jamais journaliser les secrets transitant en en-tête.
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
    remove: true,
  },
  // La redaction des en-têtes ne protège pas `req.url` : tout ce que l'URL porte part en
  // clair dans les journaux, où pino tourne en `info` jusqu'en production. On enveloppe
  // donc le sérialiseur standard (surtout pas de passthrough : il exposerait l'objet
  // requête entier).
  serializers: {
    req(req: IncomingMessage) {
      const serialized = stdSerializers.req(req);
      if (typeof serialized.url === 'string') serialized.url = redactUrl(serialized.url);
      return serialized;
    },
  },
};

/**
 * Journalisation HTTP structurée (pino-http) : une ligne JSON par requête avec
 * request-id, méthode, URL, statut et durée. Attache `req.log` (logger enfant
 * corrélé au request-id) réutilisable dans les handlers et le middleware d'erreur.
 */
export const httpLogger = pinoHttp({ ...httpLoggerOptions, logger });
