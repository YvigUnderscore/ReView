// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Neutralization of the MIME type declared at upload.
 *
 * Files are served from the same domain as the application (the reverse proxy exposes MinIO
 * under `/<bucket>/…`, cf. `nginx/nginx.conf`): an object rendered by the browser as `text/html`
 * or `image/svg+xml` would therefore run script **on the app's origin**, with access to the
 * session token. Since the `Content-Type` is chosen by the client when the URL is signed, it
 * cannot be considered trustworthy.
 *
 * Policy: an allowlist of the types really meant to be rendered inline (raster images, video,
 * audio, PDF, plain text). **Everything else**, including the countless VFX formats (EXR, USD,
 * ABC, R3D…) that no browser renders natively, is stored as `application/octet-stream`. Nothing
 * is refused: only active rendering is.
 */

/** Types rendered inline by the UI, with no script capability. */
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

/** Fallback for any unlisted type: downloaded, never interpreted. */
export const OPAQUE_CONTENT_TYPE = 'application/octet-stream';

/**
 * Reduces a `Content-Type` declared by the client to a safe value.
 * Parameters (`; charset=…`) are stripped: they serve to hide an active type behind a harmless
 * prefix and add nothing to storage.
 */
export function safeUploadContentType(declared: string | null | undefined): string {
  if (!declared) return OPAQUE_CONTENT_TYPE;
  const base = declared.split(';')[0]!.trim().toLowerCase();
  return INLINE_SAFE.has(base) ? base : OPAQUE_CONTENT_TYPE;
}

/**
 * Image type deduced from the EXTENSION of the storage key.
 *
 * Used to force the response's `Content-Type` for objects uploaded via presigned PUT (studio
 * logo, avatars): the signature does not constrain the header sent at upload, so the stored type
 * is not reliable. The key, however, is built by the server from an already validated type:
 * that is the only safe source.
 */
export function imageTypeFromKey(key: string): string {
  const ext = key.slice(key.lastIndexOf('.')).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.gif') return 'image/gif';
  return OPAQUE_CONTENT_TYPE;
}

/** True if the type would be actively interpreted by the browser (HTML, SVG, XML…). */
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
