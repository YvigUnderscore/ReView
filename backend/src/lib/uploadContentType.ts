// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Neutralisation du type MIME déclaré à l'upload.
 *
 * Les fichiers sont servis depuis le même domaine que l'application (le reverse-proxy
 * expose MinIO sous `/<bucket>/…`, cf. `nginx/nginx.conf`) : un objet rendu par le
 * navigateur en `text/html` ou `image/svg+xml` exécuterait donc du script **sur l'origine
 * de l'app**, avec accès au jeton de session. Comme le `Content-Type` est choisi par le
 * client au moment de la signature de l'URL, il ne peut pas être considéré comme fiable.
 *
 * Politique : liste blanche des types réellement destinés à être rendus en ligne
 * (images matricielles, vidéo, audio, PDF, texte brut) ; **tout le reste** — y compris les
 * innombrables formats VFX (EXR, USD, ABC, R3D…) qu'aucun navigateur ne rend nativement —
 * est stocké en `application/octet-stream`. Rien n'est refusé : seul le rendu actif l'est.
 */

/** Types rendus en ligne par l'UI, sans capacité de script. */
const INLINE_SAFE = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/bmp',
  'image/tiff',
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/x-matroska',
  'audio/mpeg',
  'audio/mp4',
  'audio/ogg',
  'audio/wav',
  'audio/webm',
  'audio/x-wav',
  'application/pdf',
  'application/vnd.apple.mpegurl',
  'application/x-mpegurl',
  'video/mp2t',
  'text/plain',
]);

/** Repli pour tout type non listé : téléchargé, jamais interprété. */
export const OPAQUE_CONTENT_TYPE = 'application/octet-stream';

/**
 * Ramène un `Content-Type` déclaré par le client à une valeur sûre.
 * Les paramètres (`; charset=…`) sont retirés : ils servent à masquer un type actif
 * derrière un préfixe anodin et n'apportent rien au stockage.
 */
export function safeUploadContentType(declared: string | null | undefined): string {
  if (!declared) return OPAQUE_CONTENT_TYPE;
  const base = declared.split(';')[0]!.trim().toLowerCase();
  return INLINE_SAFE.has(base) ? base : OPAQUE_CONTENT_TYPE;
}

/** Vrai si le type serait interprété activement par le navigateur (HTML, SVG, XML…). */
export function isActiveContentType(declared: string | null | undefined): boolean {
  if (!declared) return false;
  const base = declared.split(';')[0]!.trim().toLowerCase();
  return (
    base === 'text/html' ||
    base === 'image/svg+xml' ||
    base === 'application/xhtml+xml' ||
    base === 'application/xml' ||
    base === 'text/xml' ||
    base.endsWith('+xml') ||
    base === 'text/javascript' ||
    base === 'application/javascript' ||
    base === 'application/x-javascript'
  );
}
