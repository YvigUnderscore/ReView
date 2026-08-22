// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Proxy web des images de production (EXR, DPX, TIFF, TGA).
 *
 * Un navigateur ne décode aucun de ces formats. Sans dérivé, la review d'image se réduit à
 * une vignette de 640 px : la page charge un `<img src>` que rien n'affiche, et l'A/B, le
 * wipe et le diff n'ont plus de source. Le worker produit donc, à côté de la miniature, un
 * JPEG **pleine résolution** qui devient l'image servie au viewer ; l'original reste dans
 * MinIO et reste téléchargeable.
 *
 * Ce module ne contient que les décisions — quels formats, quels arguments FFmpeg — pour
 * qu'elles soient testables sans lancer de processus. L'exécution est dans le worker.
 */

/**
 * Images qu'un navigateur affiche telles quelles. Tout ce qui est classé `IMAGE` et
 * n'est pas dans cette liste a besoin d'un proxy.
 *
 * BMP et GIF y figurent : ils sont exotiques en production mais nativement rendus par
 * tous les navigateurs — leur fabriquer un JPEG serait de la perte sèche (et, pour un GIF
 * animé, une régression : le proxy n'en garderait que la première image).
 */
export const BROWSER_IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'] as const;

/** Nom de l'objet dérivé, sous le préfixe `derived/{mediaId}/`. */
export const WEB_PROXY_FILENAME = 'proxy.jpg';
export const WEB_PROXY_CONTENT_TYPE = 'image/jpeg';

/** Clé de stockage du proxy web d'un média image. */
export const webProxyKey = (mediaId: number): string => `derived/${mediaId}/${WEB_PROXY_FILENAME}`;

/** Cette image a-t-elle besoin d'un dérivé pour être consultable en review ? */
export function needsWebProxy(ext: string): boolean {
  const e = ext.toLowerCase();
  return (
    e.startsWith('.') && !BROWSER_IMAGE_EXTENSIONS.includes(e as (typeof BROWSER_IMAGE_EXTENSIONS)[number])
  );
}

/**
 * Options **d'entrée** FFmpeg propres au décodeur du format source.
 *
 * Un EXR est linéaire par construction. Le décodeur `exr` de FFmpeg n'applique par défaut
 * aucune courbe (`-apply_trc gamma` avec `-gamma 1`, soit l'identité) : converti tel quel
 * en JPEG, un rendu correct sort quasi noir et le superviseur juge une image fausse. On
 * applique donc la fonction de transfert sRGB (IEC 61966-2-1) à la lecture.
 *
 * Le DPX, lui, n'expose aucune option de ce genre : il est repiqué tel qu'il est encodé
 * (les DPX log/Cineon sortiront délavés — leur conversion correcte relève de la passe OCIO,
 * pas de ce dérivé). Les options ne sont jamais posées « au cas où » : `-apply_trc` sur un
 * décodeur qui ne la connaît pas fait échouer la commande entière.
 */
export function imageDecodeInputOptions(ext: string): string[] {
  return ext.toLowerCase() === '.exr' ? ['-apply_trc', 'iec61966_2_1'] : [];
}

/**
 * Options de sortie du proxy JPEG.
 *
 * `-q:v 2` est la meilleure qualité utile de l'encodeur mjpeg (l'échelle va de 2 à 31) ;
 * `yuvj420p` est imposé parce qu'une source flottante (EXR) ou 16 bits (TIFF, DPX) ne
 * partage aucun format de pixel avec l'encodeur mjpeg, qui échouerait sur la négociation.
 * Une seule image est écrite : sans `-frames:v 1`, un TIFF multi-page produirait une suite.
 */
export function webProxyOutputOptions(): string[] {
  return ['-frames:v', '1', '-pix_fmt', 'yuvj420p', '-q:v', '2'];
}

/**
 * Borne de sécurité sur la taille du proxy.
 *
 * Une plaque 8K reste servie à sa résolution native — c'est le propos. Mais le JPEG
 * n'admet pas plus de 65 535 pixels par côté, et un panorama de scan peut les dépasser :
 * on redimensionne alors au lieu d'échouer. `-2` conserve le rapport en gardant une
 * dimension paire (contrainte du sous-échantillonnage 4:2:0).
 */
export const WEB_PROXY_MAX_SIDE = 16384;

export function webProxyScaleFilter(width: number, height: number): string | null {
  const longest = Math.max(width, height);
  if (!Number.isFinite(longest) || longest <= WEB_PROXY_MAX_SIDE) return null;
  return width >= height ? `scale=${WEB_PROXY_MAX_SIDE}:-2` : `scale=-2:${WEB_PROXY_MAX_SIDE}`;
}
