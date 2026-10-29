// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { z } from 'zod';
import { prisma } from './prisma';
import { storage } from '../services/StorageService';
import { imageTypeFromKey } from './uploadContentType';

/**
 * Styling of the login page — set by the admin, applied before any authentication. Background image (S3 key),
 * veil and blur to keep the form readable whatever the image, layout (split panel or centred form), free tagline
 * and logo display. Stored in `Setting.login_appearance`.
 *
 * The veil and the blur are not cosmetic: a light photo under a light form makes the fields unreadable, and the
 * admin should not have to retouch their image for that.
 */

export interface LoginAppearance {
  layout: 'split' | 'centered';
  /** Storage object key; `null` = no image (default accent gradient). */
  bgKey: string | null;
  bgFit: 'cover' | 'contain';
  /** Opacity of the veil over the image, 0 → 0.95. */
  overlay: number;
  /** Blur of the image, in pixels, 0 → 24. */
  blur: number;
  /** Custom tagline; empty string = default translated text. */
  tagline: string;
  showLogo: boolean;
}

const LOGIN_KEY = 'login_appearance';

const FALLBACK: LoginAppearance = {
  layout: 'split',
  bgKey: null,
  bgFit: 'cover',
  overlay: 0.45,
  blur: 0,
  tagline: '',
  showLogo: true,
};

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);

function sanitize(raw: unknown, base: LoginAppearance): LoginAppearance {
  const o = (raw ?? {}) as Partial<LoginAppearance>;
  const bgKey = typeof o.bgKey === 'string' ? o.bgKey.trim() : undefined;
  return {
    layout: o.layout === 'centered' || o.layout === 'split' ? o.layout : base.layout,
    // An empty key means "no image": this is what the "remove" button sends.
    bgKey: bgKey === undefined ? (o.bgKey === null ? null : base.bgKey) : bgKey || null,
    bgFit: o.bgFit === 'contain' || o.bgFit === 'cover' ? o.bgFit : base.bgFit,
    overlay: Number.isFinite(o.overlay) ? clamp(Number(o.overlay), 0, 0.95) : base.overlay,
    blur: Number.isFinite(o.blur) ? clamp(Math.round(Number(o.blur)), 0, 24) : base.blur,
    tagline: typeof o.tagline === 'string' ? o.tagline.slice(0, 200) : base.tagline,
    showLogo: typeof o.showLogo === 'boolean' ? o.showLogo : base.showLogo,
  };
}

/** Effective config (Setting merged with the internal fallback). */
export async function getLoginAppearance(): Promise<LoginAppearance> {
  const row = await prisma.setting.findUnique({ where: { key: LOGIN_KEY } });
  if (!row) return FALLBACK;
  try {
    return sanitize(JSON.parse(row.value), FALLBACK);
  } catch {
    return FALLBACK;
  }
}

/** Saves the config (validated/bounded) — partial patch applied on top of the existing one. */
export async function setLoginAppearance(value: unknown): Promise<LoginAppearance> {
  const clean = sanitize(value, await getLoginAppearance());
  await prisma.setting.upsert({
    where: { key: LOGIN_KEY },
    update: { value: JSON.stringify(clean) },
    create: { key: LOGIN_KEY, value: JSON.stringify(clean) },
  });
  return clean;
}

export const loginAppearanceSchema = z.object({
  layout: z.enum(['split', 'centered']).optional(),
  bgKey: z.string().max(300).nullable().optional(),
  bgFit: z.enum(['cover', 'contain']).optional(),
  overlay: z.number().min(0).max(0.95).optional(),
  blur: z.number().int().min(0).max(24).optional(),
  tagline: z.string().max(200).optional(),
  showLogo: z.boolean().optional(),
});

/** Presigned URL of the login background image (one hour), `null` if there is no image. */
export function loginBgUrl(bgKey: string | null): Promise<string | null> | null {
  return bgKey ? storage.getPresignedGetUrl(bgKey, 3600, imageTypeFromKey(bgKey)) : null;
}

export const __testing = { sanitize, FALLBACK, LOGIN_KEY };
