// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { z } from 'zod';
import { prisma } from './prisma';
import { encryptSecret, decryptSecret } from './crypto';
import { storage } from '../services/StorageService';
import { imageTypeFromKey } from './uploadContentType';

/**
 * SSO OIDC (36.A) — configuration studio (Setting `oidc_config`). Le client secret est
 * chiffré (AES-GCM) et write-only : jamais renvoyé à l'admin, conservé si absent du PUT.
 */

export interface OidcConfig {
  enabled: boolean;
  issuer: string; // ex https://accounts.google.com
  clientId: string;
  clientSecret: string; // en clair côté serveur uniquement (déchiffré à la lecture)
  publicUrl: string; // base publique de l'app — redirect_uri = publicUrl + /api/auth/oidc/callback
  autoProvision: boolean; // créer un compte ARTIST à la volée si l'email est inconnu
  buttonLabel: string;
  passwordLoginDisabled: boolean; // « SSO seul » : plus de connexion email + mot de passe
  logoKey: string; // clé MinIO du logo affiché dans le bouton SSO (`branding/sso-*`)
}

const OIDC_KEY = 'oidc_config';

/** Emplacement imposé au logo SSO : le reste du bucket n'a rien à faire dans un `<img>`. */
const LOGO_KEY_RE = /^branding\/[A-Za-z0-9._-]{1,120}$/;

const FALLBACK: OidcConfig = {
  enabled: false,
  issuer: 'https://accounts.google.com',
  clientId: '',
  clientSecret: '',
  publicUrl: '',
  autoProvision: false,
  buttonLabel: 'Se connecter avec Google',
  passwordLoginDisabled: false,
  logoKey: '',
};

function sanitize(raw: unknown, base: OidcConfig): OidcConfig {
  const o = (raw ?? {}) as Partial<OidcConfig>;
  const str = (v: unknown, b: string, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : b);
  const logoKey = str(o.logoKey, base.logoKey, 200);
  return {
    enabled: typeof o.enabled === 'boolean' ? o.enabled : base.enabled,
    issuer: str(o.issuer, base.issuer),
    clientId: str(o.clientId, base.clientId),
    clientSecret: typeof o.clientSecret === 'string' ? o.clientSecret : base.clientSecret,
    publicUrl: str(o.publicUrl, base.publicUrl).replace(/\/+$/, ''),
    autoProvision: typeof o.autoProvision === 'boolean' ? o.autoProvision : base.autoProvision,
    buttonLabel: str(o.buttonLabel, base.buttonLabel, 80),
    passwordLoginDisabled:
      typeof o.passwordLoginDisabled === 'boolean' ? o.passwordLoginDisabled : base.passwordLoginDisabled,
    // Une clé hors `branding/` est écartée plutôt que refusée : le vide vaut « pas de logo ».
    logoKey: logoKey === '' || LOGO_KEY_RE.test(logoKey) ? logoKey : base.logoKey,
  };
}

/** Le SSO peut-il réellement prendre une connexion en charge ? (config complète) */
export function isOidcReady(cfg: OidcConfig): boolean {
  return cfg.enabled && !!cfg.clientId && !!cfg.clientSecret && !!cfg.publicUrl;
}

/**
 * « SSO seul » effectif : le mot de passe n'est refusé QUE si le SSO est en état de
 * prendre le relais. Sans ce garde-fou, un secret révoqué chez le fournisseur ou une
 * config à moitié effacée fermerait l'instance à tout le monde, admins compris, sans
 * autre issue qu'un accès direct à la base.
 */
export async function isPasswordLoginBlocked(): Promise<boolean> {
  const cfg = await getOidcConfig();
  return cfg.passwordLoginDisabled && isOidcReady(cfg);
}

/** URL présignée du logo SSO (1 h), `null` si aucun logo n'est configuré. */
export async function getOidcLogoUrl(logoKey: string): Promise<string | null> {
  if (!logoKey) return null;
  return storage.getPresignedGetUrl(logoKey, 3600, imageTypeFromKey(logoKey));
}

/** Config effective (secret déchiffré) — usage serveur uniquement. */
export async function getOidcConfig(): Promise<OidcConfig> {
  const row = await prisma.setting.findUnique({ where: { key: OIDC_KEY } });
  if (!row) return FALLBACK;
  try {
    const stored = sanitize(JSON.parse(row.value), FALLBACK);
    return { ...stored, clientSecret: stored.clientSecret ? (decryptSecret(stored.clientSecret) ?? '') : '' };
  } catch {
    return FALLBACK;
  }
}

/** Vue admin : jamais le secret, juste sa présence — et le logo en URL affichable. */
export async function getPublicOidcConfig(): Promise<
  Omit<OidcConfig, 'clientSecret'> & { hasSecret: boolean; logoUrl: string | null }
> {
  const cfg = await getOidcConfig();
  const { clientSecret, ...rest } = cfg;
  return { ...rest, hasSecret: clientSecret.length > 0, logoUrl: await getOidcLogoUrl(cfg.logoKey) };
}

/** Enregistre (secret write-only : absent/vide = conservé). */
export async function setOidcConfig(value: unknown): Promise<void> {
  const current = await getOidcConfig();
  const next = sanitize(value, { ...current, clientSecret: '' });
  const secretPlain = next.clientSecret || current.clientSecret;
  await prisma.setting.upsert({
    where: { key: OIDC_KEY },
    update: {
      value: JSON.stringify({ ...next, clientSecret: secretPlain ? encryptSecret(secretPlain) : '' }),
    },
    create: {
      key: OIDC_KEY,
      value: JSON.stringify({ ...next, clientSecret: secretPlain ? encryptSecret(secretPlain) : '' }),
    },
  });
}

export const oidcConfigSchema = z.object({
  enabled: z.boolean().optional(),
  issuer: z.string().url().max(500).optional(),
  clientId: z.string().max(500).optional(),
  clientSecret: z.string().max(500).optional(), // write-only
  publicUrl: z.string().url().max(500).optional(),
  autoProvision: z.boolean().optional(),
  buttonLabel: z.string().max(80).optional(),
  passwordLoginDisabled: z.boolean().optional(),
  logoKey: z.string().max(200).optional(),
});

export const __testing = { sanitize, FALLBACK };
