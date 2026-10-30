// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { z } from 'zod';
import { prisma } from './prisma';
import { encryptSecret, decryptSecret } from './crypto';
import { storage } from './storage';
import { imageTypeFromKey } from './uploadContentType';
import { badRequest } from './errors';

/**
 * OIDC SSO (36.A) — studio configuration (Setting `oidc_config`). The client secret is encrypted (AES-GCM) and
 * write-only: never returned to the admin, kept when absent from the PUT.
 */

export interface OidcConfig {
  enabled: boolean;
  issuer: string; // e.g. https://accounts.google.com
  clientId: string;
  clientSecret: string; // plaintext, server side only (decrypted on read)
  publicUrl: string; // public base URL of the app — redirect_uri = publicUrl + /api/auth/oidc/callback
  autoProvision: boolean; // create an ARTIST account on the fly if the email is unknown
  buttonLabel: string;
  passwordLoginDisabled: boolean; // "SSO only": no more email + password login
  logoKey: string; // MinIO key of the logo shown on the SSO button (`branding/sso-*`)
}

const OIDC_KEY = 'oidc_config';

/** Imposed location of the SSO logo: the rest of the bucket has no business in an `<img>`. */
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
    // A key outside `branding/` is discarded rather than refused: empty means "no logo".
    logoKey: logoKey === '' || LOGO_KEY_RE.test(logoKey) ? logoKey : base.logoKey,
  };
}

/** Can SSO actually take a login in charge? (complete config) */
export function isOidcReady(cfg: OidcConfig): boolean {
  return cfg.enabled && !!cfg.clientId && !!cfg.clientSecret && !!cfg.publicUrl;
}

/**
 * Effective "SSO only": the password is refused ONLY if SSO is in a state to take over. Without this safeguard, a secret
 * revoked at the provider or a half-erased config would lock the instance to everyone, admins included, with no way out
 * but direct database access.
 */
export async function isPasswordLoginBlocked(): Promise<boolean> {
  const cfg = await getOidcConfig();
  return cfg.passwordLoginDisabled && isOidcReady(cfg);
}

/** Presigned URL of the SSO logo (1 h), `null` if no logo is configured. */
export async function getOidcLogoUrl(logoKey: string): Promise<string | null> {
  if (!logoKey) return null;
  return storage.getPresignedGetUrl(logoKey, 3600, imageTypeFromKey(logoKey));
}

/** Effective config (secret decrypted) — server-side use only. */
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

/** Admin view: never the secret, just its presence — and the logo as a displayable URL. */
export async function getPublicOidcConfig(): Promise<
  Omit<OidcConfig, 'clientSecret'> & { hasSecret: boolean; logoUrl: string | null }
> {
  const cfg = await getOidcConfig();
  const { clientSecret, ...rest } = cfg;
  return { ...rest, hasSecret: clientSecret.length > 0, logoUrl: await getOidcLogoUrl(cfg.logoKey) };
}

/** Saves (write-only secret: absent/empty = kept). */
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

/**
 * Applies an admin patch while keeping the instance openable.
 *
 * "SSO only" only makes sense if SSO can take over. Two cases are distinguished: an explicit request to cut the password
 * without an operational SSO is refused outright (the admin learns it now, not at their next login); whereas if it is
 * SSO that has just been disabled or emptied, the password takes control again by itself, rather than blocking a
 * legitimate change.
 */
export async function updateOidcConfig(patch: Record<string, unknown>): Promise<void> {
  const next = { ...(await getOidcConfig()), ...patch };
  if (next.passwordLoginDisabled && !isOidcReady(next)) {
    if (patch.passwordLoginDisabled === true) {
      throw badRequest(
        'SSO must be enabled and complete (issuer, client ID, secret, public URL) before turning off password login',
        'SSO_NOT_READY',
      );
    }
    await setOidcConfig({ ...patch, passwordLoginDisabled: false });
    return;
  }
  await setOidcConfig(patch);
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
