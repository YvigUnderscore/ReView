// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { prisma } from '../lib/prisma';
import { env } from '../config/env';
import { encryptSecret, decryptSecret } from '../lib/crypto';
import { logger } from '../lib/logger';

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
  /** Un mot de passe est enregistré (jamais sa valeur). */
  hasPassword: boolean;
  /**
   * Autorise le dialogue SMTP EN CLAIR avec ce relais (échappatoire, cf. `lib/mailer`).
   *
   * Par défaut `false` : le transport exige STARTTLS. Un relais interne sans certificat
   * est le seul cas légitime de la poser — c'est un choix qui doit se voir, pas un défaut
   * silencieux, puisqu'il remet les identifiants SMTP et les liens d'invitation sur le
   * réseau en clair.
   */
  allowInsecure: boolean;
  /**
   * Un mot de passe est enregistré mais ne se déchiffre plus (clé de chiffrement changée).
   *
   * Aucun mail ne part alors — `getEffectiveConfig` refuse la configuration. Sans ce
   * drapeau, l'administrateur voit une configuration en apparence complète et des envois
   * qui échouent sans motif : il faut lire les journaux du serveur pour comprendre.
   * Le dire ici met la cause sous les yeux de qui peut la corriger (ressaisir le secret).
   */
  passwordUnreadable: boolean;
  /** `true` si l'environnement (`SMTP_HOST`) prend le pas sur la configuration en base. */
  envOverride: boolean;
}

/**
 * Mot de passe effectif du relais, et le cas où il est devenu illisible.
 *
 * Partagé par `getPublicConfig` (ce que l'admin voit) et `getEffectiveConfig` (ce que le
 * transport reçoit) : les deux doivent dire la même chose du même état, sinon l'écran
 * annonce un relais sain pendant que les envois échouent.
 */
function resolvePassword(s: StoredSmtp): { pass?: string; unreadable: boolean } {
  // L'environnement prime : le secret en base n'est alors même pas lu.
  if (env.SMTP_PASS !== undefined) return { pass: env.SMTP_PASS, unreadable: false };
  if (!s.passwordEnc) return { unreadable: false };
  const decrypted = decryptSecret(s.passwordEnc);
  return decrypted === null ? { unreadable: true } : { pass: decrypted, unreadable: false };
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
  /** Dialogue en clair explicitement autorisé (relais interne sans TLS). */
  allowInsecure: boolean;
}

/** Config effective pour l'envoi : l'environnement écrase la base champ par champ. */
export async function getEffectiveConfig(): Promise<SmtpEffectiveConfig | null> {
  const s = await read();
  const host = env.SMTP_HOST ?? s.host;
  if (!host) return null;
  // Échec FERMÉ, pas dégradé. Un mot de passe illisible (clé de chiffrement changée)
  // partait jusqu'ici en `undefined` : le transport tentait alors un AUTH sans mot de
  // passe, le relais refusait, et rien ne disait pourquoi. On refuse la configuration —
  // `lib/crypto` a déjà journalisé le geste à faire, et `getPublicConfig` le montre à
  // l'écran d'administration (`passwordUnreadable`).
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
  /** Nouveau mot de passe (write-only). Vide/omis = conserver l'existant. */
  password?: string;
  /** Voir `SmtpPublicConfig.allowInsecure` — omis = conserver le réglage en place. */
  allowInsecure?: boolean;
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
    allowInsecure: input.allowInsecure ?? current.allowInsecure,
  };
  await prisma.setting.upsert({
    where: { key: SMTP_KEY },
    update: { value: JSON.stringify(next) },
    create: { key: SMTP_KEY, value: JSON.stringify(next) },
  });
  return getPublicConfig();
}
