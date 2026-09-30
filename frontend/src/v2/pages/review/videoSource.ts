// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Quelle piste le lecteur doit-il ouvrir : l'échelle HLS ou le fichier MP4 ?
 *
 * La question n'est pas seulement une affaire de bande passante. Le trim non-destructif ne
 * produit **pas** de nouvelles renditions : il grave la coupe dans un proxy MP4 dédié
 * (`trimProxyKey`) et laisse l'échelle HLS telle qu'elle était, c'est-à-dire tirée du média
 * entier. Préférer le master HLS dès qu'il existe — la configuration par défaut — revenait
 * donc à rejouer le média non coupé : le point d'entrée et le point de sortie posés par
 * l'utilisateur n'avaient aucun effet, et l'ombrage des zones coupées disparaissait de la
 * timeline au moment même où la coupe devenait active. Rien à l'écran ne le signalait.
 *
 * Tant que le proxy coupé n'est pas prêt, le master HLS reste le bon choix : il montre le
 * média entier, et la timeline grise ce qui sera retiré.
 */

export interface VideoSourceMedia {
  /** Renditions HLS disponibles (`null` : média transcodé avant l'échelle adaptative). */
  hls: unknown;
  /** Bornes de la coupe non-destructive, en frames. */
  trim: unknown;
  /** Le proxy coupé est produit et servi par `proxyUrl`. */
  trimProxyReady: boolean;
}

/**
 * Le master HLS peut-il servir ? Non dès qu'une coupe est effective : seul le proxy MP4
 * porte la coupe.
 */
export function canPlayHlsMaster(media: VideoSourceMedia): boolean {
  return Boolean(media.hls) && !(Boolean(media.trim) && media.trimProxyReady);
}

/** URL du master HLS servi par le proxy authentifié, ou `null` s'il ne doit pas servir. */
export function hlsMasterUrl(mediaId: number, media: VideoSourceMedia): string | null {
  return canPlayHlsMaster(media) ? `/api/media/${String(mediaId)}/hls/master.m3u8` : null;
}
