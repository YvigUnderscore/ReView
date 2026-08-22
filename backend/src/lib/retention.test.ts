// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Aucune base réelle : chaque délégué Prisma touché par la rétention est simulé.
vi.mock('./prisma', () => {
  const delegate = () => ({
    findMany: vi.fn().mockResolvedValue([]),
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
  });
  return {
    prisma: {
      setting: { findUnique: vi.fn(), upsert: vi.fn() },
      auditLog: delegate(),
      mediaAccessLog: delegate(),
      notification: delegate(),
      userSession: delegate(),
      passwordReset: delegate(),
      invitation: delegate(),
      shareLink: delegate(),
      shotgridSyncRun: delegate(),
      apiEvent: delegate(),
    },
  };
});
vi.mock('./logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../services/AuditService', () => ({ logAudit: vi.fn() }));

import {
  RETENTION_DEFAULTS,
  RETENTION_FAMILIES,
  deleteInBatches,
  getRetentionPolicy,
  setRetentionPolicy,
  sweepRetention,
  __testing,
  type RetentionPolicy,
} from './retention';
import { prisma } from './prisma';
import { logAudit } from '../services/AuditService';

const DAY = 86_400_000;

/** Politique où seule la famille passée en argument est active. */
function onlyFamily(family: keyof RetentionPolicy, days: number): RetentionPolicy {
  const policy = { ...RETENTION_DEFAULTS };
  for (const f of RETENTION_FAMILIES) policy[f] = 0;
  policy[family] = days;
  return policy;
}

beforeEach(() => vi.clearAllMocks());

/** Arguments du premier appel simulé : les types génériques de Prisma ne servent à rien ici. */
function firstCall<T>(fn: unknown): T {
  return (fn as { mock: { calls: unknown[][] } }).mock.calls[0]![0] as T;
}

describe('retention.sanitize', () => {
  const { sanitize } = __testing;

  it('borne chaque durée à [0, 3650] jours et arrondit', () => {
    const out = sanitize({ auditLog: -5, mediaAccessLog: 99_999, notification: 12.6 }, RETENTION_DEFAULTS);
    expect(out.auditLog).toBe(0);
    expect(out.mediaAccessLog).toBe(3650);
    expect(out.notification).toBe(13);
  });

  it('borne la taille de tranche à [100, 20000]', () => {
    expect(sanitize({ batchSize: 1 }, RETENTION_DEFAULTS).batchSize).toBe(100);
    expect(sanitize({ batchSize: 1e9 }, RETENTION_DEFAULTS).batchSize).toBe(20_000);
  });

  it('une valeur absente ou illisible garde la valeur en place, pas 0', () => {
    const base = { ...RETENTION_DEFAULTS, auditLog: 42 };
    expect(sanitize({}, base)).toEqual(base);
    expect(sanitize({ auditLog: 'beaucoup' }, base).auditLog).toBe(42);
  });
});

describe('lecture / écriture de la politique', () => {
  it('sans réglage enregistré, renvoie les valeurs par défaut', async () => {
    vi.mocked(prisma.setting.findUnique).mockResolvedValue(null);
    await expect(getRetentionPolicy()).resolves.toEqual(RETENTION_DEFAULTS);
  });

  it('un réglage illisible ne fait pas tomber la purge : repli sur les défauts', async () => {
    vi.mocked(prisma.setting.findUnique).mockResolvedValue({ value: '{oops' } as never);
    await expect(getRetentionPolicy()).resolves.toEqual(RETENTION_DEFAULTS);
  });

  it('écrit une politique assainie (les valeurs hors bornes ne sont jamais persistées)', async () => {
    vi.mocked(prisma.setting.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.setting.upsert).mockResolvedValue({} as never);

    const saved = await setRetentionPolicy({ auditLog: 99_999, notification: 30 });

    expect(saved.auditLog).toBe(3650);
    expect(saved.notification).toBe(30);
    const call = firstCall<{ where: { key: string }; create: { value: string } }>(prisma.setting.upsert);
    // La clé persistée est un contrat : la renommer perdrait la politique du studio.
    expect(call.where.key).toBe(__testing.RETENTION_KEY);
    expect(__testing.RETENTION_KEY).toBe('retention_policy');
    expect(JSON.parse(call.create.value)).toEqual(saved);
  });
});

describe('deleteInBatches — suppression par tranches plafonnées', () => {
  it('s’arrête dès qu’une tranche est incomplète et ne réinterroge pas la base', async () => {
    const findExpiredIds = vi.fn().mockResolvedValueOnce([1, 2]);
    const deleteByIds = vi.fn().mockResolvedValue(2);

    const out = await deleteInBatches({ findExpiredIds, deleteByIds }, new Date(), {
      batchSize: 10,
      maxBatches: 5,
    });

    expect(out).toEqual({ deleted: 2, truncated: false });
    expect(findExpiredIds).toHaveBeenCalledTimes(1);
  });

  it('enchaîne les tranches pleines et signale la troncature au plafond', async () => {
    const full = [1, 2];
    const findExpiredIds = vi.fn().mockResolvedValue(full);
    const deleteByIds = vi.fn().mockResolvedValue(2);
    const sleep = vi.fn().mockResolvedValue(undefined);

    const out = await deleteInBatches({ findExpiredIds, deleteByIds }, new Date(), {
      batchSize: 2,
      maxBatches: 3,
      pauseMs: 25,
      sleep,
    });

    expect(out).toEqual({ deleted: 6, truncated: true });
    expect(findExpiredIds).toHaveBeenCalledTimes(3);
    // Une respiration entre deux tranches — pas après la dernière.
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(25);
  });

  it('table déjà vide : aucune suppression', async () => {
    const deleteByIds = vi.fn();
    const out = await deleteInBatches(
      { findExpiredIds: vi.fn().mockResolvedValue([]), deleteByIds },
      new Date(),
      { batchSize: 10, maxBatches: 5 },
    );
    expect(out).toEqual({ deleted: 0, truncated: false });
    expect(deleteByIds).not.toHaveBeenCalled();
  });
});

describe('sweepRetention', () => {
  const now = new Date('2026-08-22T03:00:00.000Z');

  it('ne touche pas une famille réglée à 0 (conservation illimitée)', async () => {
    await sweepRetention({ policy: onlyFamily('auditLog', 10), now, pauseMs: 0 });

    expect(prisma.notification.findMany).not.toHaveBeenCalled();
    expect(prisma.mediaAccessLog.findMany).not.toHaveBeenCalled();
    expect(prisma.auditLog.findMany).toHaveBeenCalledTimes(1);
  });

  it('calcule la coupure à N jours et remonte le total supprimé', async () => {
    vi.mocked(prisma.auditLog.findMany).mockResolvedValueOnce([{ id: 1 }, { id: 2 }] as never);
    vi.mocked(prisma.auditLog.deleteMany).mockResolvedValueOnce({ count: 2 });

    const out = await sweepRetention({ policy: onlyFamily('auditLog', 10), now, pauseMs: 0 });

    const args = firstCall<{ where: { createdAt: { lt: Date } } }>(prisma.auditLog.findMany);
    expect(args.where.createdAt.lt.getTime()).toBe(now.getTime() - 10 * DAY);
    expect(firstCall(prisma.auditLog.deleteMany)).toEqual({ where: { id: { in: [1, 2] } } });
    expect(out.total).toBe(2);
    expect(out.families.auditLog).toBe(2);
    expect(out.truncated).toBe(false);
  });

  it('consigne une trace d’audit quand elle a supprimé, et rien quand la base est propre', async () => {
    await sweepRetention({ policy: onlyFamily('auditLog', 10), now, pauseMs: 0 });
    expect(logAudit).not.toHaveBeenCalled();

    vi.mocked(prisma.auditLog.findMany).mockResolvedValueOnce([{ id: 7 }] as never);
    vi.mocked(prisma.auditLog.deleteMany).mockResolvedValueOnce({ count: 1 });
    await sweepRetention({ policy: onlyFamily('auditLog', 10), now, pauseMs: 0 });

    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'RETENTION_SWEEP', entityType: 'Setting' }),
    );
  });

  it('une famille en échec n’empêche pas les suivantes de passer', async () => {
    const policy = { ...RETENTION_DEFAULTS };
    for (const f of RETENTION_FAMILIES) policy[f] = 0;
    policy.auditLog = 10;
    policy.apiEvent = 10;
    vi.mocked(prisma.auditLog.findMany).mockRejectedValueOnce(new Error('table verrouillée'));
    vi.mocked(prisma.apiEvent.findMany).mockResolvedValueOnce([{ id: 3 }] as never);
    vi.mocked(prisma.apiEvent.deleteMany).mockResolvedValueOnce({ count: 1 });

    const out = await sweepRetention({ policy, now, pauseMs: 0 });

    expect(out.families.auditLog).toBe(0);
    expect(out.families.apiEvent).toBe(1);
    expect(out.total).toBe(1);
  });

  it('sessions : ne cible que celles mortes avant la coupure, jamais une session vivante', async () => {
    await sweepRetention({ policy: onlyFamily('userSession', 30), now, pauseMs: 0 });

    const args = firstCall<{ where: { OR: Record<string, { lt: Date }>[] } }>(prisma.userSession.findMany);
    const cutoff = now.getTime() - 30 * DAY;
    expect(args.where.OR).toHaveLength(2);
    expect(args.where.OR[0]!.revokedAt!.lt.getTime()).toBe(cutoff);
    expect(args.where.OR[1]!.expiresAt!.lt.getTime()).toBe(cutoff);
  });

  it('liens de partage : un lien actif sans expiration n’est jamais ciblé', async () => {
    await sweepRetention({ policy: onlyFamily('shareLink', 180), now, pauseMs: 0 });

    const args = firstCall<{ where: { OR: Record<string, unknown>[] } }>(prisma.shareLink.findMany);
    expect(args.where.OR[0]).toMatchObject({ revoked: true });
    expect(args.where.OR[1]).toHaveProperty('expiresAt');
  });

  it('ShotGrid : une passe portant un conflit non arbitré est épargnée', async () => {
    await sweepRetention({ policy: onlyFamily('shotgridSync', 90), now, pauseMs: 0 });

    const args = firstCall<{ where: { logs: { none: unknown } }; take: number }>(
      prisma.shotgridSyncRun.findMany,
    );
    expect(args.where.logs.none).toEqual({ level: 'conflict', resolvedAt: null });
    // Lot réduit : supprimer une passe emporte ses lignes de journal par cascade.
    expect(args.take).toBe(RETENTION_DEFAULTS.batchSize / 10);
  });
});
