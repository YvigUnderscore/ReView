// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { z } from 'zod';
import { storage } from '../services/StorageService';

/**
 * Studio branding images (logo, login background, SSO button logo).
 *
 * All three follow the same rule, which is why they share this module: they are served from the
 * app's origin, so no SVG: an SVG is a scriptable document, and a logo uploaded by an admin does
 * not warrant inheriting the origin.
 */

/** Types accepted on upload of a branding image: the same list for all three. */
export const brandingUploadSchema = z.object({
  contentType: z.string().regex(/^image\/(png|jpe?g|webp)$/),
});

/** Timestamped key + presigned URL (15 min) for uploading a branding image. */
export async function presignBrandingUpload(
  prefix: string,
  contentType: string,
): Promise<{ key: string; url: string }> {
  const ext = contentType.includes('png') ? '.png' : contentType.includes('webp') ? '.webp' : '.jpg';
  const key = `branding/${prefix}-${Date.now()}${ext}`;
  return { key, url: await storage.getPresignedPutUrl(key, contentType, 900) };
}
