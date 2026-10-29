// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Effective SMTP configuration: what reaches the transport.
 *
 * Two properties are at stake. An unreadable password (encryption key changed) used to go out as
 * `undefined` and sending continued without it: a silent failure, doubled by a degraded AUTH. And
 * plaintext dialogue must only be possible through an explicit setting, never by default.
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

/** `Setting` row as the service reads it. */
const stored = (value: Record<string, unknown>) =>
  vi
    .mocked(prisma.setting.findUnique)
    .mockResolvedValue({ key: 'smtp_config', value: JSON.stringify(value) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(decryptSecret).mockReturnValue('motdepasse');
});

describe('unreadable password (A3-03 / A3-08)', () => {
  it('refuses the configuration instead of sending without a password', async () => {
    stored({ host: 'smtp.studio', passwordEnc: 'iv.tag.data.abcd1234' });
    vi.mocked(decryptSecret).mockReturnValue(null);
    expect(await getEffectiveConfig()).toBeNull();
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('serves the configuration normally when it decrypts', async () => {
    stored({ host: 'smtp.studio', passwordEnc: 'iv.tag.data.abcd1234', user: 'studio' });
    const cfg = await getEffectiveConfig();
    expect(cfg?.pass).toBe('motdepasse');
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('decrypts nothing when the environment imposes the password', async () => {
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

describe('internal relay without TLS escape hatch (A3-04)', () => {
  it('requires encryption by default', async () => {
    stored({ host: 'smtp.studio' });
    expect((await getEffectiveConfig())?.allowInsecure).toBe(false);
    expect((await getPublicConfig()).allowInsecure).toBe(false);
  });

  it('passes the explicit setting through to the transport', async () => {
    stored({ host: 'smtp.studio', allowInsecure: true });
    expect((await getEffectiveConfig())?.allowInsecure).toBe(true);
    expect((await getPublicConfig()).allowInsecure).toBe(true);
  });

  it('keeps the setting when the save does not mention it', async () => {
    stored({ host: 'smtp.studio', allowInsecure: true });
    vi.mocked(prisma.setting.upsert).mockResolvedValue({} as never);
    await setConfig({ host: 'smtp.studio2' });
    const ecrit = JSON.parse(
      (vi.mocked(prisma.setting.upsert).mock.calls[0]![0] as { update: { value: string } }).update.value,
    ) as { allowInsecure?: boolean };
    expect(ecrit.allowInsecure).toBe(true);
  });
});

describe('unreadable password visible to the administrator (A3-03)', () => {
  it('reports it in the public configuration, rather than leaving it to guesswork', async () => {
    stored({ host: 'smtp.studio', passwordEnc: 'iv.tag.data.abcd1234' });
    vi.mocked(decryptSecret).mockReturnValue(null);
    const pub = await getPublicConfig();
    expect(pub.passwordUnreadable).toBe(true);
    // A password is indeed stored: it is its reading that fails, not its absence.
    expect(pub.hasPassword).toBe(true);
  });

  it('does not report it when it decrypts', async () => {
    stored({ host: 'smtp.studio', passwordEnc: 'iv.tag.data.abcd1234' });
    expect((await getPublicConfig()).passwordUnreadable).toBe(false);
  });

  it('does not report it when the environment imposes the password', async () => {
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

  it('does not report it when no password is stored', async () => {
    stored({ host: 'smtp.studio' });
    expect((await getPublicConfig()).passwordUnreadable).toBe(false);
  });
});
