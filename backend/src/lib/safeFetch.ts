// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { AppError } from './errors';
import { assertPublicHttpTarget } from './ssrfGuard';

/**
 * RÈGLE DU PROJET — aucun `fetch` nu dans `backend/src`.
 *
 * Toute requête sortante part d'un processus (API ou worker) situé DANS le réseau
 * applicatif, où MinIO, Redis, Postgres, Grafana et — chez un hébergeur cloud — le service
 * de métadonnées sur 169.254.169.254 répondent sans authentification réseau. Une URL qui
 * vient d'ailleurs (saisie d'admin, abonnement d'un navigateur, réponse d'un site distant)
 * ne doit donc jamais être passée telle quelle à `fetch` : elle vaudrait capacité d'émettre
 * des requêtes arbitraires depuis ce réseau.
 *
 * `safeFetch` réunit les quatre protections qui doivent aller ensemble :
 *
 * 1. **Garde SSRF sur l'adresse résolue** (`assertPublicHttpTarget`) : schéma http(s)
 *    seulement, et refus de tout nom dont UNE des adresses tombe dans un espace interne.
 * 2. **Redirections jamais suivies en aveugle** : `redirect: 'manual'`. Une redirection est
 *    une seconde requête vers une cible que personne n'a contrôlée — c'est le contournement
 *    classique d'une vérification faite avant l'appel. Quand `maxRedirects > 0`, chaque saut
 *    est re-soumis à la garde, et seules les méthodes sûres (GET/HEAD) sont rejouées.
 * 3. **Délai d'attente** sur l'arrivée des EN-TÊTES. Il est volontairement levé une fois la
 *    réponse ouverte : un master de dailies met plus de trente secondes à descendre, et le
 *    couper à mi-flux casserait la synchronisation ShotGrid.
 * 4. **Taille de réponse bornée** (`maxBytes`) : `Content-Length` annoncé ET octets réellement
 *    lus, pour qu'un serveur distant ne puisse pas faire enfler la mémoire d'un worker.
 *
 * `allowHosts` est l'unique échappatoire — elle existe pour le simulateur ShotGrid de
 * développement (`SHOTGRID_INSECURE_HOSTS`), qui vit précisément sur une adresse privée.
 */

/** Délai d'attente par défaut des en-têtes de réponse. */
const DEFAULT_TIMEOUT_MS = 15_000;

/** Codes qui décrivent une redirection ; `fetch` ne les suit pas en mode `manual`. */
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);

/** Statuts dont le corps est nécessairement vide : `new Response` les refuse avec un corps. */
const NULL_BODY_STATUS = new Set([101, 103, 204, 205, 304]);

export interface SafeFetchOptions {
  /** Délai d'attente des en-têtes, en millisecondes (défaut : 15 s). */
  timeoutMs?: number;
  /** Redirections suivies, chacune revérifiée par la garde (défaut : 0 = aucune). */
  maxRedirects?: number;
  /** Plafond d'octets du corps de réponse ; absent = pas de plafond (flux média). */
  maxBytes?: number;
  /** Hôtes (`hostname:port`) dispensés de la garde — simulateur de développement seulement. */
  allowHosts?: Iterable<string>;
}

/** Cible refusée avant même d'émettre : adresse interne, schéma interdit, redirection non suivie. */
export class OutboundBlockedError extends AppError {
  constructor(
    readonly target: string,
    readonly reason: string,
  ) {
    super(`Outbound request refused: ${reason}`, 502, 'OUTBOUND_BLOCKED');
    this.name = 'OutboundBlockedError';
  }
}

/** Les en-têtes de réponse ne sont pas arrivés dans le délai imparti. */
export class OutboundTimeoutError extends AppError {
  constructor(
    readonly target: string,
    readonly timeoutMs: number,
  ) {
    super(`Outbound request timed out after ${timeoutMs} ms`, 504, 'OUTBOUND_TIMEOUT');
    this.name = 'OutboundTimeoutError';
  }
}

/** La réponse dépasse le plafond d'octets accepté. */
export class OutboundTooLargeError extends AppError {
  constructor(
    readonly target: string,
    readonly maxBytes: number,
  ) {
    super(`Outbound response exceeds ${maxBytes} bytes`, 502, 'OUTBOUND_TOO_LARGE');
    this.name = 'OutboundTooLargeError';
  }
}

function normalizeHosts(hosts?: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const raw of hosts ?? []) {
    const host = raw.trim().toLowerCase();
    if (host) out.add(host);
  }
  return out;
}

function toUrl(input: string | URL): URL {
  try {
    return input instanceof URL ? input : new URL(input);
  } catch {
    throw new OutboundBlockedError(String(input), 'invalid URL');
  }
}

/**
 * Cible acceptable ? Le schéma est contrôlé même pour un hôte dispensé : `file://` ou
 * `redis://` n'ont jamais de raison d'être ici.
 */
export async function assertOutboundTarget(url: URL, allowHosts?: Iterable<string>): Promise<void> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new OutboundBlockedError(url.href, `scheme not allowed (${url.protocol.replace(':', '')})`);
  if (normalizeHosts(allowHosts).has(url.host.toLowerCase())) return;
  const verdict = await assertPublicHttpTarget(url.href);
  if (!verdict.ok) throw new OutboundBlockedError(url.href, verdict.reason);
}

/**
 * Une requête, un délai d'attente sur les en-têtes. Le minuteur est désarmé dès que la
 * réponse s'ouvre : le corps peut ensuite se lire aussi longtemps qu'il faut.
 */
async function fetchOnce(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new OutboundTimeoutError(url, timeoutMs)), timeoutMs);
  const upstream = init.signal ?? undefined;
  const relay = () => controller.abort(upstream?.reason);
  if (upstream) {
    if (upstream.aborted) relay();
    else upstream.addEventListener('abort', relay, { once: true });
  }
  try {
    return await fetch(url, { ...init, redirect: 'manual', signal: controller.signal });
  } finally {
    clearTimeout(timer);
    upstream?.removeEventListener('abort', relay);
  }
}

/**
 * Réponse re-emballée derrière un compteur d'octets. On contrôle d'abord la taille
 * annoncée (refus immédiat, sans rien télécharger), puis la taille réelle — un serveur
 * hostile n'est pas tenu de dire la vérité dans `Content-Length`.
 */
function limitResponseBody(res: Response, maxBytes: number, target: string): Response {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    void res.body?.cancel().catch(() => undefined);
    throw new OutboundTooLargeError(target, maxBytes);
  }
  if (!res.body || NULL_BODY_STATUS.has(res.status)) return res;

  let seen = 0;
  const limited = res.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        seen += chunk.byteLength;
        if (seen > maxBytes) {
          controller.error(new OutboundTooLargeError(target, maxBytes));
          return;
        }
        controller.enqueue(chunk);
      },
    }),
  );
  return new Response(limited, {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
  });
}

/**
 * `fetch` durci : garde SSRF à chaque saut, redirections maîtrisées, délai d'attente et
 * taille de réponse bornée. Voir l'en-tête de fichier pour la règle et ses raisons.
 */
export async function safeFetch(
  input: string | URL,
  init: RequestInit = {},
  options: SafeFetchOptions = {},
): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, maxRedirects = 0, maxBytes, allowHosts } = options;
  const method = (init.method ?? 'GET').toUpperCase();
  let current = toUrl(input);

  for (let hop = 0; ; hop += 1) {
    await assertOutboundTarget(current, allowHosts);
    const res = await fetchOnce(current.href, init, timeoutMs);
    if (!REDIRECT_STATUS.has(res.status))
      return maxBytes === undefined ? res : limitResponseBody(res, maxBytes, current.href);

    // Redirection : le corps ne nous intéresse pas, et le laisser ouvert retiendrait le socket.
    await res.body?.cancel().catch(() => undefined);
    if (hop >= maxRedirects)
      throw new OutboundBlockedError(current.href, `redirect not followed (HTTP ${res.status})`);
    // Rejouer un POST/PUT vers une adresse choisie par le serveur, c'est lui prêter la
    // charge utile : seules les méthodes sûres sont suivies.
    if (method !== 'GET' && method !== 'HEAD')
      throw new OutboundBlockedError(current.href, `redirect on a ${method} request is not followed`);
    const location = res.headers.get('location');
    if (!location) throw new OutboundBlockedError(current.href, 'redirect without a Location header');
    try {
      current = new URL(location, current);
    } catch {
      throw new OutboundBlockedError(current.href, 'redirect to an unusable location');
    }
  }
}
