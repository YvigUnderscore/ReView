// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Le journal d'audit ne vaut que par ce qu'on peut en relire, et par ce qu'on ne peut pas
 * en effacer. Ces tests fixent les trois propriétés correspondantes :
 *
 * - `list` restitue `metadata` (il était supprimé de la réponse : « MEDIA_PURGE · 812 »
 *   sans dire lesquels des trois cents identifiants du lot étaient partis) ;
 * - il le restitue **rédigé** — le chemin d'une URL de webhook est un secret, pas une
 *   donnée d'audit ;
 * - `logAudit` double l'écriture en base d'une émission sur le journal pino, hors de
 *   portée de la politique de rétention.
 */

const { prismaMock, loggerMock, avatarUrlMock } = vi.hoisted(() => ({
  prismaMock: {
    auditLog: { findMany: vi.fn(), count: vi.fn(), create: vi.fn() },
  },
  loggerMock: { info: vi.fn(), warn: vi.fn() },
  avatarUrlMock: vi.fn(() => Promise.resolve(null)),
}));

vi.mock('../lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('../lib/logger', () => ({ logger: loggerMock }));
vi.mock('../lib/userView', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/userView')>();
  return { ...actual, avatarUrl: avatarUrlMock };
});

import {
  list,
  logAudit,
  logLoginAttempt,
  redactAuditMetadata,
  purgeableAuditWhere,
  AUDIT_RETENTION_MIN_DAYS,
  AUDIT_UNPURGEABLE_ACTIONS,
} from './AuditService';

const page = { page: 1, pageSize: 20, order: 'desc' as const, cursor: undefined, sort: undefined };

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.auditLog.count.mockResolvedValue(1);
  prismaMock.auditLog.create.mockReturnValue({ catch: vi.fn() });
});

describe('AuditService.list — restitution du metadata (A5-03)', () => {
  it('rend le metadata de chaque ligne', async () => {
    prismaMock.auditLog.findMany.mockResolvedValue([
      {
        id: 7,
        userId: 3,
        action: 'MEDIA_PURGE',
        entityType: 'MediaObject',
        entityId: 812,
        createdAt: new Date('2026-09-16T10:00:00Z'),
        metadata: { ids: [812, 813, 814] },
        user: null,
      },
    ]);
    const res = (await list(page)) as { items: { metadata: unknown }[] };
    expect(res.items[0]!.metadata).toEqual({ ids: [812, 813, 814] });
  });

  it("n'expose ni le jeton d'un webhook ni un secret nommé", async () => {
    prismaMock.auditLog.findMany.mockResolvedValue([
      {
        id: 8,
        userId: 3,
        action: 'WEBHOOK_CREATE',
        entityType: 'Webhook',
        entityId: 1,
        createdAt: new Date('2026-09-16T10:00:00Z'),
        metadata: {
          url: 'https://discord.com/api/webhooks/123/SUPER-SECRET',
          webhookSecret: 'hmac-key',
          events: ['media.created'],
        },
        user: null,
      },
    ]);
    const res = (await list(page)) as { items: { metadata: Record<string, unknown> }[] };
    const meta = res.items[0]!.metadata;
    expect(meta.url).toBe('https://discord.com/…');
    expect(meta.webhookSecret).toBe('[Redacted]');
    expect(meta.events).toEqual(['media.created']);
    expect(JSON.stringify(meta)).not.toContain('SUPER-SECRET');
    expect(JSON.stringify(meta)).not.toContain('hmac-key');
  });

  it('ne rend jamais ni userId brut ni objet utilisateur complet', async () => {
    prismaMock.auditLog.findMany.mockResolvedValue([
      {
        id: 9,
        userId: 3,
        action: 'LOGIN',
        entityType: 'User',
        entityId: 3,
        createdAt: new Date(),
        metadata: {},
        user: {
          id: 3,
          email: 'a@b.c',
          name: 'Ana',
          firstName: null,
          lastName: null,
          username: null,
          avatarKey: null,
        },
      },
    ]);
    const res = (await list(page)) as { items: Record<string, unknown>[] };
    expect(res.items[0]).not.toHaveProperty('userId');
    expect(res.items[0]!.user).toMatchObject({ id: 3, displayName: 'Ana' });
  });
});

describe('redactAuditMetadata — rédiger plutôt qu’omettre', () => {
  it('laisse passer nombres, booléens, null et chaînes ordinaires', () => {
    expect(redactAuditMetadata({ count: 3, ok: true, none: null, name: 'Seq 010' })).toEqual({
      count: 3,
      ok: true,
      none: null,
      name: 'Seq 010',
    });
  });

  it('réduit une URL à son origine, mais laisse intacte une clé de réglage homonyme', () => {
    expect(redactAuditMetadata({ url: 'https://hooks.slack.com/services/T/B/XYZ' })).toEqual({
      url: 'https://hooks.slack.com/…',
    });
    // `key` vaut le NOM du réglage, pas une cible : rien à rédiger.
    expect(redactAuditMetadata({ key: 'slack_webhook_url' })).toEqual({ key: 'slack_webhook_url' });
  });

  it('borne les listes, les chaînes et la profondeur', () => {
    const many = Array.from({ length: 120 }, (_, i) => i);
    const redacted = redactAuditMetadata({ ids: many }) as { ids: unknown[] };
    expect(redacted.ids).toHaveLength(51);
    expect(redacted.ids[50]).toBe('… +70');

    const long = redactAuditMetadata({ label: 'x'.repeat(400) }) as { label: string };
    expect(long.label).toHaveLength(257);

    const deep = redactAuditMetadata({ a: { b: { c: { d: { e: 1 } } } } }) as Record<string, never>;
    expect(JSON.stringify(deep)).toContain('[Redacted]');
  });

  it('rédige un secret quelle que soit sa profondeur', () => {
    expect(redactAuditMetadata({ smtp: { host: 'mail.test', password: 'hunter2' } })).toEqual({
      smtp: { host: 'mail.test', password: '[Redacted]' },
    });
  });
});

describe('logAudit — copie hors de portée de la rétention (A5-04)', () => {
  it('émet la ligne sur le journal pino en plus de la base', () => {
    logAudit({ userId: 1, action: 'RETENTION_CONFIG', entityType: 'Setting', metadata: { auditLog: 1 } });
    expect(prismaMock.auditLog.create).toHaveBeenCalledOnce();
    expect(loggerMock.info).toHaveBeenCalledWith(
      { audit: expect.objectContaining({ action: 'RETENTION_CONFIG', metadata: { auditLog: 1 } }) },
      '[audit]',
    );
  });

  it('rédige aussi la copie journalisée', () => {
    logAudit({
      userId: 1,
      action: 'WEBHOOK_CREATE',
      metadata: { url: 'https://discord.com/api/webhooks/1/TOK' },
    });
    expect(JSON.stringify(loggerMock.info.mock.calls[0])).not.toContain('TOK');
  });

  it('écrit le metadata brut en base : la rédaction ne vaut que pour la restitution', () => {
    logAudit({ userId: 1, action: 'SHARE_UNLOCK_FAIL', metadata: { ip: '10.1.2.3' } });
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ metadata: { ip: '10.1.2.3' } }),
    });
  });
});

describe('logLoginAttempt — la connexion laisse une trace (A5-03)', () => {
  it('consigne LOGIN avec l’auteur quand l’accès est accordé', () => {
    logLoginAttempt({ user: { id: 7 }, granted: true, email: 'alice@studio.com', ip: '10.1.2.3' });

    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: {
        userId: 7,
        action: 'LOGIN',
        entityType: 'User',
        entityId: 7,
        metadata: { email: 'alice@studio.com', ip: '10.1.2.3' },
      },
    });
  });

  it('consigne LOGIN_FAIL sans auteur quand l’adresse ne correspond à aucun compte', () => {
    logLoginAttempt({ user: null, granted: false, email: 'fantome@studio.com' });

    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: {
        userId: null,
        action: 'LOGIN_FAIL',
        entityType: 'User',
        entityId: null,
        // L'adresse visée est la donnée qui rend l'énumération visible.
        metadata: { email: 'fantome@studio.com', ip: null },
      },
    });
  });

  it('distingue un mot de passe validé d’une session ouverte quand le 2FA est actif', () => {
    logLoginAttempt({
      user: { id: 7, totpEnabledAt: new Date() },
      granted: true,
      email: 'alice@studio.com',
    });

    const { data } = prismaMock.auditLog.create.mock.calls[0]![0] as {
      data: { action: string; metadata: Record<string, unknown> };
    };
    expect(data.action).toBe('LOGIN');
    expect(data.metadata.pending2fa).toBe(true);
  });

  it('n’a aucun moyen de journaliser le mot de passe : il ne lui est pas passé', () => {
    logLoginAttempt({ user: { id: 7 }, granted: false, email: 'alice@studio.com' });

    expect(JSON.stringify(prismaMock.auditLog.create.mock.calls)).not.toContain('password');
  });
});

describe('Garde-fous de rétention offerts au balayage (A5-04)', () => {
  it('exclut les actions qui décrivent un effacement', () => {
    const cutoff = new Date('2026-01-01T00:00:00Z');
    expect(purgeableAuditWhere(cutoff)).toEqual({
      createdAt: { lt: cutoff },
      action: { notIn: AUDIT_UNPURGEABLE_ACTIONS },
    });
    expect(AUDIT_UNPURGEABLE_ACTIONS).toContain('RETENTION_CONFIG');
    expect(AUDIT_UNPURGEABLE_ACTIONS).toContain('RETENTION_RUN');
    expect(AUDIT_UNPURGEABLE_ACTIONS).toContain('RETENTION_SWEEP');
  });

  it('pose un plancher de conservation qui rend la manœuvre « 1 jour » impossible', () => {
    expect(AUDIT_RETENTION_MIN_DAYS).toBeGreaterThanOrEqual(90);
  });
});
