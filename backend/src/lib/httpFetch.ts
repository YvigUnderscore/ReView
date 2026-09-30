// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  assertOutboundTarget,
  OutboundBlockedError,
  OutboundTimeoutError,
  OutboundTooLargeError,
} from './safeFetch';

/**
 * Sortie durcie **avec allow-list d'hôtes ré-évaluée à chaque saut**.
 *
 * `safeFetch` est la porte de sortie ordinaire du backend : elle contrôle l'ADRESSE
 * résolue à chaque saut (anti-SSRF), borne le délai et la taille. Elle ne connaît en
 * revanche pas les allow-lists applicatives — celle des assets OCIO, par exemple, qui
 * n'accepte que `github.com` et les hôtes de contenu de GitHub. Or GitHub sert justement
 * ses assets par une redirection 302, et une allow-list contrôlée une seule fois sur
 * l'URL de départ ne dit rien de la cible réellement atteinte : c'est le contournement
 * classique. Il faut donc suivre la redirection *et* la re-soumettre à l'allow-list.
 *
 * D'où ce module, deuxième — et dernier — endroit du backend qui appelle `fetch`
 * directement. Chaque saut y passe par les deux gardes, dans cet ordre :
 *
 * 1. `assertOutboundTarget` : schéma http(s) et refus de toute adresse interne (boucle
 *    locale, RFC 1918, lien-local 169.254.169.254 des métadonnées cloud) ;
 * 2. `isAllowedHost` : l'allow-list de l'appelant, sur l'hôte de CE saut.
 *
 * S'y ajoutent le délai d'attente sur l'arrivée des en-têtes (désarmé ensuite, comme dans
 * `safeFetch` : un téléchargement peut durer) et le refus de rejouer une méthode non sûre
 * vers une cible choisie par le serveur distant.
 *
 * `readCappedBody` complète le tableau côté lecture : un `Content-Length` annoncé n'engage
 * que celui qui le croit, on compte donc aussi les octets réellement reçus.
 */

/** Délai d'attente par défaut des en-têtes de réponse. */
const DEFAULT_TIMEOUT_MS = 15_000;

/** Codes de redirection ; `fetch` ne les suit pas en mode `manual`. */
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);

export interface AllowlistedFetchOptions {
  /** Allow-list applicative, ré-évaluée à chaque saut. Rendre `false` refuse la cible. */
  isAllowedHost: (url: URL) => boolean;
  /** Délai d'attente des en-têtes, en millisecondes (défaut : 15 s). */
  timeoutMs?: number;
  /** Redirections suivies, chacune re-soumise aux deux gardes (défaut : 3). */
  maxRedirects?: number;
}

function toUrl(input: string | URL): URL {
  try {
    return input instanceof URL ? input : new URL(input);
  } catch {
    throw new OutboundBlockedError(String(input), 'invalid URL');
  }
}

/**
 * Une requête, un délai d'attente sur les en-têtes. Le minuteur est désarmé dès que la
 * réponse s'ouvre : le corps se lit ensuite aussi longtemps qu'il faut (une config ACES
 * de 25 Mo derrière une liaison lente reste légitime).
 */
async function fetchOnce(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new OutboundTimeoutError(url, timeoutMs)), timeoutMs);
  try {
    return await fetch(url, { ...init, redirect: 'manual', signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * `fetch` durci dont chaque saut — départ compris — doit satisfaire la garde SSRF ET
 * l'allow-list de l'appelant. Voir l'en-tête de fichier pour le pourquoi.
 */
export async function fetchAllowlisted(
  input: string | URL,
  init: RequestInit = {},
  options: AllowlistedFetchOptions,
): Promise<Response> {
  const { isAllowedHost, timeoutMs = DEFAULT_TIMEOUT_MS, maxRedirects = 3 } = options;
  const method = (init.method ?? 'GET').toUpperCase();
  let current = toUrl(input);

  for (let hop = 0; ; hop += 1) {
    await assertOutboundTarget(current);
    if (!isAllowedHost(current)) throw new OutboundBlockedError(current.href, 'host is not allow-listed');

    const res = await fetchOnce(current.href, init, timeoutMs);
    if (!REDIRECT_STATUS.has(res.status)) return res;

    // Le corps d'une redirection ne nous intéresse pas, et le laisser ouvert retiendrait
    // le socket jusqu'au ramasse-miettes.
    await res.body?.cancel().catch(() => undefined);
    if (hop >= maxRedirects)
      // Motifs volontairement sans prose : ils sortent en 502, ils ne s'affichent pas.
      throw new OutboundBlockedError(current.href, 'redirect-limit-exceeded');
    if (method !== 'GET' && method !== 'HEAD')
      throw new OutboundBlockedError(current.href, 'redirect-on-unsafe-method');
    const location = res.headers.get('location');
    if (!location) throw new OutboundBlockedError(current.href, 'redirect without a Location header');
    try {
      current = new URL(location, current);
    } catch {
      throw new OutboundBlockedError(current.href, 'redirect to an unusable location');
    }
  }
}

/**
 * Lit un corps de réponse en mémoire sous plafond d'octets. Le `Content-Length` annoncé
 * est refusé d'emblée s'il dépasse — puis les octets reçus sont comptés, parce qu'un
 * serveur hostile n'est pas tenu de dire la vérité dans ses en-têtes.
 */
export async function readCappedBody(res: Response, maxBytes: number, target = res.url): Promise<Buffer> {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel().catch(() => undefined);
    throw new OutboundTooLargeError(target, maxBytes);
  }
  if (!res.body) return Buffer.alloc(0);

  const reader = res.body.getReader();
  const chunks: Buffer[] = [];
  let seen = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    seen += value.byteLength;
    if (seen > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new OutboundTooLargeError(target, maxBytes);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}
