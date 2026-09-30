// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { z } from 'zod';
import { storage } from '../services/StorageService';

/**
 * Images d'habillage du studio (logo, fond de connexion, logo du bouton SSO).
 *
 * Les trois suivent la même règle, et c'est pour cela qu'elles partagent ce module :
 * elles sont servies depuis l'origine de l'app, donc pas de SVG — un SVG est un document
 * scriptable, et un logo téléversé par un admin ne vaut pas qu'on lui prête l'origine.
 */

/** Types acceptés à l'upload d'une image d'habillage — la même liste pour les trois. */
export const brandingUploadSchema = z.object({
  contentType: z.string().regex(/^image\/(png|jpe?g|webp)$/),
});

/** Clé horodatée + URL présignée (15 min) pour déposer une image d'habillage. */
export async function presignBrandingUpload(
  prefix: string,
  contentType: string,
): Promise<{ key: string; url: string }> {
  const ext = contentType.includes('png') ? '.png' : contentType.includes('webp') ? '.webp' : '.jpg';
  const key = `branding/${prefix}-${Date.now()}${ext}`;
  return { key, url: await storage.getPresignedPutUrl(key, contentType, 900) };
}
