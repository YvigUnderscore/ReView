// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Réécriture des playlists HLS (vague 2 — servir la vidéo sans traverser Node).
 *
 * Le worker FFmpeg écrit des playlists à URI **relatifs** (`720p.m3u8`, `720p_003.ts`).
 * Servies telles quelles derrière `/api/media/:id/hls/:file`, elles faisaient repasser
 * chaque segment de 2 s par le process web. On les réécrit désormais à la volée :
 *  - le **maître** garde des URI relatifs (donc l'API) mais leur accroche le jeton de
 *    lecture, ce qui évite de refaire le contrôle d'accès en base pour chaque rendition ;
 *  - la **sous-playlist** remplace chaque segment par une URL MinIO présignée absolue :
 *    le lecteur va chercher les octets au stockage, plus jamais à l'API.
 *
 * Tout est pur et sans I/O : la signature des URL, elle, vit dans MediaService.
 */

/** Fenêtre de signature des URL de segments (s) — cf. `signingWindowStart`. */
export const HLS_URL_WINDOW_SEC = 15 * 60;

/** Durée de vie des URL présignées de segments (s), comptée depuis la fenêtre. */
export const HLS_URL_TTL_SEC = 2 * 60 * 60;

/**
 * Début de la fenêtre courante (ms epoch).
 *
 * Une URL présignée est unique par instant de signature : signées à la demande, vingt
 * spectateurs d'un même daily demanderaient vingt URL différentes pour le même segment, et
 * aucun cache partagé ne pourrait les rapprocher. On gèle donc la playlist réécrite par
 * fenêtre : dans les quinze minutes, tout le monde reçoit les MÊMES URL — le cache du
 * frontal (et celui du navigateur au rechargement) redevient utile.
 */
export function signingWindowStart(nowMs: number = Date.now(), windowSec = HLS_URL_WINDOW_SEC): number {
  const windowMs = windowSec * 1000;
  return Math.floor(nowMs / windowMs) * windowMs;
}

/**
 * Nom de fichier HLS acceptable : pas de séparateur, pas de `..`, pas de query. Le même
 * motif que la route — on le revérifie ici parce que ces noms viennent du CONTENU d'une
 * playlist et servent à composer une clé de stockage à présigner.
 */
export function isSafeHlsName(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) && !name.includes('..');
}

/** Attribut `URI="…"` d'une balise (`#EXT-X-MAP`, `#EXT-X-I-FRAME-STREAM-INF`, `#EXT-X-KEY`). */
const TAG_URI = /URI="([^"]*)"/g;

/**
 * Applique `map` à chaque URI de la playlist : les lignes nues (segment ou sous-playlist)
 * et les attributs `URI="…"` des balises. Les commentaires, balises et lignes vides sont
 * rendus intacts, et la playlist garde sa structure ligne à ligne.
 */
export function rewritePlaylistUris(playlist: string, map: (uri: string) => string): string {
  return playlist
    .split('\n')
    .map((rawLine) => {
      const line = rawLine.replace(/\r$/, '');
      if (line.trim() === '') return line;
      if (line.startsWith('#')) return line.replace(TAG_URI, (_m, uri: string) => `URI="${map(uri)}"`);
      return map(line.trim());
    })
    .join('\n');
}

/** Tous les URI référencés par la playlist, dans l'ordre, sans doublon. */
export function playlistUris(playlist: string): string[] {
  const found: string[] = [];
  rewritePlaylistUris(playlist, (uri) => {
    if (!found.includes(uri)) found.push(uri);
    return uri;
  });
  return found;
}

/**
 * Maître → chaque sous-playlist porte le jeton de lecture en query. Les URI restent
 * relatifs : le lecteur les résout contre l'URL du maître, donc sur `/api/media/:id/hls/`.
 */
export function withPlaybackToken(master: string, token: string): string {
  const q = `pt=${encodeURIComponent(token)}`;
  return rewritePlaylistUris(master, (uri) => (uri.includes('?') ? `${uri}&${q}` : `${uri}?${q}`));
}

/**
 * Sous-playlist → chaque segment devient l'URL absolue fournie par `urls`. Un URI absent de
 * la table (nom inattendu, donc jamais présigné) est laissé relatif : il retombe sur le
 * proxy `/api/media/:id/hls/:file`, qui continue de fonctionner. Aucune lecture ne casse.
 */
export function withPresignedSegments(playlist: string, urls: ReadonlyMap<string, string>): string {
  return rewritePlaylistUris(playlist, (uri) => urls.get(uri) ?? uri);
}
