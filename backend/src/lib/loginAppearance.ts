// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { z } from 'zod';
import { prisma } from './prisma';

/**
 * Habillage de la page de connexion — réglé par l'admin, appliqué avant toute
 * authentification. Image de fond (clé S3), voile et flou pour garder le formulaire
 * lisible quelle que soit l'image, disposition (panneau scindé ou formulaire centré),
 * accroche libre et affichage du logo. Stocké dans `Setting.login_appearance`.
 *
 * Le voile et le flou ne sont pas cosmétiques : une photo claire sous un formulaire clair
 * rend les champs illisibles, et l'admin n'a pas à retoucher son image pour ça.
 */

export interface LoginAppearance {
  layout: 'split' | 'centered';
  /** Clé de l'objet de stockage ; `null` = pas d'image (dégradé d'accent par défaut). */
  bgKey: string | null;
  bgFit: 'cover' | 'contain';
  /** Opacité du voile posé sur l'image, 0 → 0.95. */
  overlay: number;
  /** Flou de l'image, en pixels, 0 → 24. */
  blur: number;
  /** Accroche personnalisée ; chaîne vide = texte traduit par défaut. */
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
    // Une clé vide vaut « pas d'image » : c'est ce qu'envoie le bouton « retirer ».
    bgKey: bgKey === undefined ? (o.bgKey === null ? null : base.bgKey) : bgKey || null,
    bgFit: o.bgFit === 'contain' || o.bgFit === 'cover' ? o.bgFit : base.bgFit,
    overlay: Number.isFinite(o.overlay) ? clamp(Number(o.overlay), 0, 0.95) : base.overlay,
    blur: Number.isFinite(o.blur) ? clamp(Math.round(Number(o.blur)), 0, 24) : base.blur,
    tagline: typeof o.tagline === 'string' ? o.tagline.slice(0, 200) : base.tagline,
    showLogo: typeof o.showLogo === 'boolean' ? o.showLogo : base.showLogo,
  };
}

/** Config effective (Setting fusionné avec le repli interne). */
export async function getLoginAppearance(): Promise<LoginAppearance> {
  const row = await prisma.setting.findUnique({ where: { key: LOGIN_KEY } });
  if (!row) return FALLBACK;
  try {
    return sanitize(JSON.parse(row.value), FALLBACK);
  } catch {
    return FALLBACK;
  }
}

/** Enregistre la config (validée/bornée) — patch partiel appliqué sur l'existant. */
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

export const __testing = { sanitize, FALLBACK, LOGIN_KEY };
