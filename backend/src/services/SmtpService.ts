// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { prisma } from '../lib/prisma';
import { env } from '../config/env';
import { encryptSecret, decryptSecret } from '../lib/crypto';

/**
 * Configuration SMTP stockée en base (Phase 22) : host/port/secure/user/from + mot de passe
 * **chiffré au repos** (`lib/crypto`), **jamais renvoyé** par l'API (write-only). L'environnement
 * (`SMTP_*`) reste prioritaire (override ops) — cf. `getEffectiveConfig`.
 */

const SMTP_KEY = 'smtp_config';

interface StoredSmtp {
  host?: string;
  port?: number;
  secure?: boolean;
  user?: string;
  from?: string;
  passwordEnc?: string;
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
  /** Un mot de passe est enregistré (jamais sa valeur). */
  hasPassword: boolean;
  /** `true` si l'environnement (`SMTP_HOST`) prend le pas sur la configuration en base. */
  envOverride: boolean;
}

/** Config affichée à l'admin (valeurs en base, sans le mot de passe). */
export async function getPublicConfig(): Promise<SmtpPublicConfig> {
  const s = await read();
  return {
    host: s.host ?? '',
    port: s.port ?? 587,
    secure: s.secure ?? false,
    user: s.user ?? '',
    from: s.from ?? env.SMTP_FROM,
    hasPassword: !!s.passwordEnc || !!env.SMTP_PASS,
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
}

/** Config effective pour l'envoi : l'environnement écrase la base champ par champ. */
export async function getEffectiveConfig(): Promise<SmtpEffectiveConfig | null> {
  const s = await read();
  const host = env.SMTP_HOST ?? s.host;
  if (!host) return null;
  const pass = env.SMTP_PASS ?? (s.passwordEnc ? (decryptSecret(s.passwordEnc) ?? undefined) : undefined);
  return {
    host,
    port: env.SMTP_HOST ? env.SMTP_PORT : (s.port ?? 587),
    secure: env.SMTP_HOST ? env.SMTP_SECURE : (s.secure ?? false),
    user: env.SMTP_USER ?? s.user,
    pass,
    from: s.from ?? env.SMTP_FROM,
  };
}

export interface SmtpInput {
  host?: string;
  port?: number;
  secure?: boolean;
  user?: string;
  from?: string;
  /** Nouveau mot de passe (write-only). Vide/omis = conserver l'existant. */
  password?: string;
}

/** Enregistre la config SMTP. Le mot de passe n'est réécrit que s'il est fourni non vide. */
export async function setConfig(input: SmtpInput): Promise<SmtpPublicConfig> {
  const current = await read();
  const next: StoredSmtp = {
    host: input.host ?? current.host,
    port: input.port ?? current.port,
    secure: input.secure ?? current.secure,
    user: input.user ?? current.user,
    from: input.from ?? current.from,
    passwordEnc: input.password ? encryptSecret(input.password) : current.passwordEnc,
  };
  await prisma.setting.upsert({
    where: { key: SMTP_KEY },
    update: { value: JSON.stringify(next) },
    create: { key: SMTP_KEY, value: JSON.stringify(next) },
  });
  return getPublicConfig();
}
