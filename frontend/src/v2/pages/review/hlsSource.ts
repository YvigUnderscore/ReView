// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Règles de chargement du HLS (vague 2 — les segments ne passent plus par l'API).
 *
 * Depuis que la sous-playlist pointe des URL MinIO présignées, les requêtes d'un même
 * lecteur ne vont plus toutes au même endroit : les manifestes à l'API (`/api/…`), les
 * segments au stockage. Deux conséquences, isolées ici pour être testées sans navigateur.
 */

/** Fragment d'erreur hls.js utile ici — évite de dépendre des types du lecteur. */
export interface HlsErrorLike {
  details?: string;
  response?: { code?: number };
}

/**
 * Une URL de l'API : même origine que l'application, et chemin sous `/api/`.
 *
 * ⚠ Comparer le début de la chaîne ne suffit pas : `loadSource('/api/…')` est normalisé par
 * hls.js contre `location.href` avant tout appel réseau, et `xhrSetup` reçoit donc des URL
 * ABSOLUES. Un test sur `startsWith('/api/')` laisserait le manifeste partir sans jeton
 * (401 immédiat). En production, le stockage est servi sur la même origine que
 * l'application (`https://domaine/<bucket>/…`) : c'est le CHEMIN qui les distingue.
 */
export function isApiUrl(url: string, base: string = window.location.href): boolean {
  try {
    const target = new URL(url, base);
    return target.origin === new URL(base).origin && target.pathname.startsWith('/api/');
  } catch {
    return false;
  }
}

/**
 * Pose le jeton de session — et **seulement** sur l'API.
 *
 * L'envoyer à l'URL présignée d'un segment le livrerait au stockage (ses journaux, et une
 * autre origine en développement) sans rien y autoriser : la signature S3 suffit, et S3
 * refuse d'ailleurs deux mécanismes d'authentification concurrents.
 */
export function applyHlsAuth(xhr: XMLHttpRequest, url: string, token: string | null, base?: string): void {
  if (token && isApiUrl(url, base ?? window.location.href))
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
}

/**
 * Une URL présignée a une fin de validité. Passé ce délai (séance de dailies plus longue
 * que la durée du jeton), le segment répond 401/403 : la playlist en main est périmée, il
 * faut la redemander — le manifeste, lui, est toujours accessible.
 */
export function isExpiredMediaUrlError(data: HlsErrorLike): boolean {
  const code = data.response?.code;
  return data.details === 'fragLoadError' && (code === 401 || code === 403);
}

/**
 * Garde-fou : si le rechargement ne règle rien (droit réellement retiré pendant la lecture),
 * on cesse d'insister plutôt que de boucler sur le manifeste.
 */
export const MAX_HLS_REFRESHES = 3;
