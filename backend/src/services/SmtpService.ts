// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { prisma } from '../lib/prisma';
import { env } from '../config/env';
import { encryptSecret, decryptSecret } from '../lib/crypto';
import { logger } from '../lib/logger';

/**
 * SMTP configuration stored in the database (Phase 22): host/port/secure/user/from plus a password
 * **encrypted at rest** (`lib/crypto`), **never returned** by the API (write-only). The environment
 * (`SMTP_*`) keeps priority (ops override): see `getEffectiveConfig`.
 */

const SMTP_KEY = 'smtp_config';

interface StoredSmtp {
  host?: string;
  port?: number;
  secure?: boolean;
  user?: string;
  from?: string;
  passwordEnc?: string;
  allowInsecure?: boolean;
}

async function read(): Promise<StoredSmtp> {
  const row = await prisma.setting.findUnique({ where: { key: SMTP_KEY } });
  if (!row) return {};
  try {
    return JSON.parse(row.value) as StoredSmtp;
  } catch {
    return {};
  }
}

export interface SmtpPublicConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  from: string;
  /** A password is stored (its value is never returned). */
  hasPassword: boolean;
  /**
   * Allows plaintext SMTP dialogue with this relay (escape hatch, see `lib/mailer`).
   *
   * Defaults to `false`: the transport requires STARTTLS. An internal relay without a certificate is the
   * only legitimate case for setting it. It must be a visible choice, not a silent default, since it puts
   * SMTP credentials and invitation links on the network in clear text.
   */
  allowInsecure: boolean;
  /**
   * A password is stored but can no longer be decrypted (encryption key changed).
   *
   * No mail goes out then: `getEffectiveConfig` refuses the configuration. Without this flag, the
   * administrator would see an apparently complete configuration and sends failing for no visible reason:
   * the server logs would have to be read to understand. Saying it here puts the cause in front of whoever
   * can fix it (re-entering the secret).
   */
  passwordUnreadable: boolean;
  /** `true` if the environment (`SMTP_HOST`) takes precedence over the database configuration. */
  envOverride: boolean;
}

/**
 * Effective password of the relay, and the case where it has become unreadable.
 *
 * Shared by `getPublicConfig` (what the admin sees) and `getEffectiveConfig` (what the transport receives):
 * both must say the same thing about the same state, otherwise the screen reports a healthy relay while
 * sends fail.
 */
function resolvePassword(s: StoredSmtp): { pass?: string; unreadable: boolean } {
  // The environment wins: the stored secret is then not even read.
  if (env.SMTP_PASS !== undefined) return { pass: env.SMTP_PASS, unreadable: false };
  if (!s.passwordEnc) return { unreadable: false };
  const decrypted = decryptSecret(s.passwordEnc);
  return decrypted === null ? { unreadable: true } : { pass: decrypted, unreadable: false };
}

/** Configuration shown to the admin (database values, without the password). */
export async function getPublicConfig(): Promise<SmtpPublicConfig> {
  const s = await read();
  return {
    host: s.host ?? '',
    port: s.port ?? 587,
    secure: s.secure ?? false,
    user: s.user ?? '',
    from: s.from ?? env.SMTP_FROM,
    hasPassword: !!s.passwordEnc || !!env.SMTP_PASS,
    allowInsecure: s.allowInsecure === true,
    passwordUnreadable: resolvePassword(s).unreadable,
    envOverride: !!env.SMTP_HOST,
  };
}

export interface SmtpEffectiveConfig {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
  from: string;
  /** Plaintext dialogue explicitly allowed (internal relay without TLS). */
  allowInsecure: boolean;
}

/** Effective configuration for sending: the environment overrides the database field by field. */
export async function getEffectiveConfig(): Promise<SmtpEffectiveConfig | null> {
  const s = await read();
  const host = env.SMTP_HOST ?? s.host;
  if (!host) return null;
  // Fail CLOSED, not degraded. An unreadable password (encryption key changed) used to go out as
  // `undefined`: the transport then attempted an AUTH without a password, the relay refused, and nothing
  // said why. The configuration is refused: `lib/crypto` has already logged the action to take, and
  // `getPublicConfig` shows it on the administration screen (`passwordUnreadable`).
  const { pass, unreadable } = resolvePassword(s);
  if (unreadable) {
    logger.error(
      { host },
      '[smtp] mot de passe du relais illisible — configuration refusée. Le ressaisir dans Administration ▸ Studio ▸ SMTP.',
    );
    return null;
  }
  return {
    host,
    port: env.SMTP_HOST ? env.SMTP_PORT : (s.port ?? 587),
    secure: env.SMTP_HOST ? env.SMTP_SECURE : (s.secure ?? false),
    user: env.SMTP_USER ?? s.user,
    pass,
    from: s.from ?? env.SMTP_FROM,
    allowInsecure: s.allowInsecure === true,
  };
}

export interface SmtpInput {
  host?: string;
  port?: number;
  secure?: boolean;
  user?: string;
  from?: string;
  /** New password (write-only). Empty/omitted = keep the existing one. */
  password?: string;
  /** See `SmtpPublicConfig.allowInsecure`. Omitted = keep the current setting in place. */
  allowInsecure?: boolean;
}

/** Saves the SMTP configuration. The password is rewritten only if a non-empty value is given. */
export async function setConfig(input: SmtpInput): Promise<SmtpPublicConfig> {
  const current = await read();
  const next: StoredSmtp = {
    host: input.host ?? current.host,
    port: input.port ?? current.port,
    secure: input.secure ?? current.secure,
    user: input.user ?? current.user,
    from: input.from ?? current.from,
    passwordEnc: input.password ? encryptSecret(input.password) : current.passwordEnc,
    allowInsecure: input.allowInsecure ?? current.allowInsecure,
  };
  await prisma.setting.upsert({
    where: { key: SMTP_KEY },
    update: { value: JSON.stringify(next) },
    create: { key: SMTP_KEY, value: JSON.stringify(next) },
  });
  return getPublicConfig();
}
