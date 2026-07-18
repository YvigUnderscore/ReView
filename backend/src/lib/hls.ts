/**
 * Génération de la playlist maître HLS (Phase 23) et types associés. Pur/testable : la
 * partie ffmpeg vit dans le worker, seule la construction texte est ici.
 */

export interface HlsRendition {
  height: number;
  width: number;
  videoBitrateK: number;
  audioBitrateK: number;
  /** Nom de la sous-playlist (relatif au maître), ex. `720p.m3u8`. */
  playlist: string;
}

/** Nom de rendition standard depuis une hauteur (ex. 720 → `720p`). */
export const renditionName = (height: number) => `${height}p`;

/**
 * Durée cible d'un segment HLS (s). Courte pour des switchs de qualité réactifs : sans GOP
 * fixe, libx264 pose des keyframes jusqu'à ~10 s d'écart → segments énormes, changement de
 * rendition très lent et vidéo figée (l'audio, lui, décode) le temps du téléchargement.
 */
export const HLS_SEGMENT_SEC = 2;

/** Taille de GOP (frames) : une keyframe par segment, calée sur le fps source (repli 25). */
export function hlsGopSize(fps?: number): number {
  const f = fps && Number.isFinite(fps) && fps > 0 ? fps : 25;
  return Math.max(1, Math.round(f * HLS_SEGMENT_SEC));
}

/**
 * Playlist maître référençant chaque rendition (bande passante + résolution). Les URI sont
 * **relatifs** : servis derrière le proxy `/api/media/:id/hls/:file`, ils résolvent
 * correctement (le lecteur résout par rapport à l'URL du maître).
 */
export function buildMasterPlaylist(renditions: HlsRendition[]): string {
  const lines = ['#EXTM3U', '#EXT-X-VERSION:3'];
  for (const r of renditions) {
    const bandwidth = Math.round((r.videoBitrateK + r.audioBitrateK) * 1000);
    lines.push(`#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${r.width}x${r.height}`);
    lines.push(r.playlist);
  }
  return lines.join('\n') + '\n';
}

/** Type de contenu HTTP d'un fichier HLS (playlist ou segment). */
export function hlsContentType(file: string): string {
  return file.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t';
}
