import { z } from 'zod';
import { prisma } from './prisma';
import { encryptSecret, decryptSecret } from './crypto';

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
}

const OIDC_KEY = 'oidc_config';

const FALLBACK: OidcConfig = {
  enabled: false,
  issuer: 'https://accounts.google.com',
  clientId: '',
  clientSecret: '',
  publicUrl: '',
  autoProvision: false,
  buttonLabel: 'Se connecter avec Google',
};

function sanitize(raw: unknown, base: OidcConfig): OidcConfig {
  const o = (raw ?? {}) as Partial<OidcConfig>;
  const str = (v: unknown, b: string, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : b);
  return {
    enabled: typeof o.enabled === 'boolean' ? o.enabled : base.enabled,
    issuer: str(o.issuer, base.issuer),
    clientId: str(o.clientId, base.clientId),
    clientSecret: typeof o.clientSecret === 'string' ? o.clientSecret : base.clientSecret,
    publicUrl: str(o.publicUrl, base.publicUrl).replace(/\/+$/, ''),
    autoProvision: typeof o.autoProvision === 'boolean' ? o.autoProvision : base.autoProvision,
    buttonLabel: str(o.buttonLabel, base.buttonLabel, 80),
  };
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

/** Vue admin : jamais le secret, juste sa présence. */
export async function getPublicOidcConfig(): Promise<
  Omit<OidcConfig, 'clientSecret'> & { hasSecret: boolean }
> {
  const cfg = await getOidcConfig();
  const { clientSecret, ...rest } = cfg;
  return { ...rest, hasSecret: clientSecret.length > 0 };
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
});

export const __testing = { sanitize, FALLBACK };
