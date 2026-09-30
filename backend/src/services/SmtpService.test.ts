// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Configuration SMTP effective : ce qui arrive au transport.
 *
 * Deux propriétés s'y jouent. Un mot de passe illisible (clé de chiffrement changée)
 * partait en `undefined` et l'envoi continuait sans lui — panne muette, doublée d'un
 * AUTH dégradé. Et le dialogue en clair, lui, ne doit être possible que par un réglage
 * explicite, jamais par défaut.
 */
vi.mock('../lib/prisma', () => ({
  prisma: { setting: { findUnique: vi.fn(), upsert: vi.fn() } },
}));
vi.mock('../config/env', () => ({
  env: {
    SMTP_HOST: undefined,
    SMTP_PASS: undefined,
    SMTP_USER: undefined,
    SMTP_PORT: 587,
    SMTP_SECURE: false,
    SMTP_FROM: 'ReView <no-reply@test>',
  },
}));
vi.mock('../lib/crypto', () => ({
  encryptSecret: vi.fn((v: string) => `enc(${v})`),
  decryptSecret: vi.fn(() => 'motdepasse'),
}));
vi.mock('../lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { prisma } from '../lib/prisma';
import { decryptSecret } from '../lib/crypto';
import { logger } from '../lib/logger';
import { getEffectiveConfig, getPublicConfig, setConfig } from './SmtpService';

/** Ligne `Setting` telle que la lit le service. */
const stored = (value: Record<string, unknown>) =>
  vi
    .mocked(prisma.setting.findUnique)
    .mockResolvedValue({ key: 'smtp_config', value: JSON.stringify(value) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(decryptSecret).mockReturnValue('motdepasse');
});

describe('mot de passe illisible (A3-03 / A3-08)', () => {
  it('refuse la configuration au lieu d’envoyer sans mot de passe', async () => {
    stored({ host: 'smtp.studio', passwordEnc: 'iv.tag.data.abcd1234' });
    vi.mocked(decryptSecret).mockReturnValue(null);
    expect(await getEffectiveConfig()).toBeNull();
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('sert normalement la configuration quand il se déchiffre', async () => {
    stored({ host: 'smtp.studio', passwordEnc: 'iv.tag.data.abcd1234', user: 'studio' });
    const cfg = await getEffectiveConfig();
    expect(cfg?.pass).toBe('motdepasse');
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('ne déchiffre rien quand l’environnement impose le mot de passe', async () => {
    stored({ host: 'smtp.studio', passwordEnc: 'illisible' });
    vi.mocked(decryptSecret).mockReturnValue(null);
    const { env } = await import('../config/env');
    env.SMTP_PASS = 'depuis-l-environnement';
    try {
      expect((await getEffectiveConfig())?.pass).toBe('depuis-l-environnement');
    } finally {
      env.SMTP_PASS = undefined;
    }
  });
});

describe('échappatoire du relais interne sans TLS (A3-04)', () => {
  it('exige le chiffrement par défaut', async () => {
    stored({ host: 'smtp.studio' });
    expect((await getEffectiveConfig())?.allowInsecure).toBe(false);
    expect((await getPublicConfig()).allowInsecure).toBe(false);
  });

  it('remonte le réglage explicite jusqu’au transport', async () => {
    stored({ host: 'smtp.studio', allowInsecure: true });
    expect((await getEffectiveConfig())?.allowInsecure).toBe(true);
    expect((await getPublicConfig()).allowInsecure).toBe(true);
  });

  it('conserve le réglage quand l’enregistrement ne le mentionne pas', async () => {
    stored({ host: 'smtp.studio', allowInsecure: true });
    vi.mocked(prisma.setting.upsert).mockResolvedValue({} as never);
    await setConfig({ host: 'smtp.studio2' });
    const ecrit = JSON.parse(
      (vi.mocked(prisma.setting.upsert).mock.calls[0]![0] as { update: { value: string } }).update.value,
    ) as { allowInsecure?: boolean };
    expect(ecrit.allowInsecure).toBe(true);
  });
});

describe('mot de passe illisible visible par l’administrateur (A3-03)', () => {
  it('le signale dans la configuration publique, au lieu de laisser deviner', async () => {
    stored({ host: 'smtp.studio', passwordEnc: 'iv.tag.data.abcd1234' });
    vi.mocked(decryptSecret).mockReturnValue(null);
    const pub = await getPublicConfig();
    expect(pub.passwordUnreadable).toBe(true);
    // Un mot de passe est bien enregistré : c'est sa lecture qui échoue, pas son absence.
    expect(pub.hasPassword).toBe(true);
  });

  it('ne le signale pas quand il se déchiffre', async () => {
    stored({ host: 'smtp.studio', passwordEnc: 'iv.tag.data.abcd1234' });
    expect((await getPublicConfig()).passwordUnreadable).toBe(false);
  });

  it('ne le signale pas quand l’environnement impose le mot de passe', async () => {
    stored({ host: 'smtp.studio', passwordEnc: 'illisible' });
    vi.mocked(decryptSecret).mockReturnValue(null);
    const { env } = await import('../config/env');
    env.SMTP_PASS = 'depuis-l-environnement';
    try {
      expect((await getPublicConfig()).passwordUnreadable).toBe(false);
      expect(decryptSecret).not.toHaveBeenCalled();
    } finally {
      env.SMTP_PASS = undefined;
    }
  });

  it('ne le signale pas quand aucun mot de passe n’est enregistré', async () => {
    stored({ host: 'smtp.studio' });
    expect((await getPublicConfig()).passwordUnreadable).toBe(false);
  });
});
