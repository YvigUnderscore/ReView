// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Web proxy for production images (EXR, DPX, TIFF, TGA).
 *
 * A browser decodes none of these formats. Without a derivative, image review reduces to a 640 px thumbnail: the
 * page loads an `<img src>` that displays nothing, and A/B, wipe and diff have no source. The worker therefore
 * produces, next to the thumbnail, a **full-resolution** JPEG that becomes the image served to the viewer; the
 * original stays in MinIO and remains downloadable.
 *
 * This module only holds the decisions — which formats, which FFmpeg arguments — so they can be tested without
 * launching a process. Execution happens in the worker.
 */

/**
 * Images a browser displays as-is. Anything classed `IMAGE` and absent from this list needs a proxy.
 *
 * BMP and GIF are listed: they are exotic in production but rendered natively by every browser — producing a JPEG
 * from them would be pure loss (and, for an animated GIF, a regression: the proxy would keep only its first frame).
 */
export const BROWSER_IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'] as const;

/** Name of the derived object, under the `derived/{mediaId}/` prefix. */
export const WEB_PROXY_FILENAME = 'proxy.jpg';
export const WEB_PROXY_CONTENT_TYPE = 'image/jpeg';

/** Storage key of the web proxy of an image media. */
export const webProxyKey = (mediaId: number): string => `derived/${mediaId}/${WEB_PROXY_FILENAME}`;

/** Does this image need a derivative to be reviewable? */
export function needsWebProxy(ext: string): boolean {
  const e = ext.toLowerCase();
  return (
    e.startsWith('.') && !BROWSER_IMAGE_EXTENSIONS.includes(e as (typeof BROWSER_IMAGE_EXTENSIONS)[number])
  );
}

/**
 * FFmpeg **input** options specific to the decoder of the source format.
 *
 * An EXR is linear by construction. FFmpeg's `exr` decoder applies no curve by default (`-apply_trc gamma` with
 * `-gamma 1`, i.e. the identity): converted as-is to JPEG, a correct render comes out almost black and the supervisor
 * judges a wrong image. The sRGB transfer function (IEC 61966-2-1) is therefore applied at read time.
 *
 * The DPX exposes no such option: it is copied as encoded (log/Cineon DPX will come out washed out — their correct
 * conversion belongs to the OCIO pass, not to this derivative). Options are never set "just in case": `-apply_trc`
 * on a decoder that does not know it makes the whole command fail.
 */
export function imageDecodeInputOptions(ext: string): string[] {
  return ext.toLowerCase() === '.exr' ? ['-apply_trc', 'iec61966_2_1'] : [];
}

/**
 * Output options of the JPEG proxy.
 *
 * `-q:v 2` is the best useful quality of the mjpeg encoder (the scale runs from 2 to 31); `yuvj420p` is enforced
 * because a float (EXR) or 16-bit (TIFF, DPX) source shares no pixel format with the mjpeg encoder, which would fail
 * the negotiation. Only one image is written: without `-frames:v 1`, a multi-page TIFF would produce a sequence.
 */
export function webProxyOutputOptions(): string[] {
  return ['-frames:v', '1', '-pix_fmt', 'yuvj420p', '-q:v', '2'];
}

/**
 * Safety bound on the proxy size.
 *
 * An 8K plate stays served at its native resolution — that is the point. But JPEG does not allow more than 65,535
 * pixels per side, and a scan panorama can exceed it: we then resize instead of failing. `-2` keeps the ratio while
 * keeping an even dimension (4:2:0 subsampling constraint).
 */
export const WEB_PROXY_MAX_SIDE = 16384;

export function webProxyScaleFilter(width: number, height: number): string | null {
  const longest = Math.max(width, height);
  if (!Number.isFinite(longest) || longest <= WEB_PROXY_MAX_SIDE) return null;
  return width >= height ? `scale=${WEB_PROXY_MAX_SIDE}:-2` : `scale=-2:${WEB_PROXY_MAX_SIDE}`;
}
