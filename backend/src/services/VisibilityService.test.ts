// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/prisma', () => ({
  prisma: {
    visibilityRule: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    project: { findMany: vi.fn(), findUnique: vi.fn() },
    episode: { findMany: vi.fn(), updateMany: vi.fn() },
    sequence: { findMany: vi.fn(), updateMany: vi.fn() },
    shot: { findMany: vi.fn(), updateMany: vi.fn() },
    asset: { findMany: vi.fn(), updateMany: vi.fn() },
  },
}));

import { applyRules, createRule, setHidden } from './VisibilityService';
import { prisma } from '../lib/prisma';

const rule = (over: Record<string, unknown> = {}) => ({
  id: 1,
  studioId: 1,
  projectId: null,
  entityType: 'shot',
  matchType: 'contains',
  pattern: '_TMP',
  ignoreCase: true,
  reason: null,
  enabled: true,
  createdById: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...over,
});

/** Aucune entité nulle part, sauf pour le type qu'un test alimente explicitement. */
function emptyTables() {
  vi.mocked(prisma.episode.findMany).mockResolvedValue([] as never);
  vi.mocked(prisma.sequence.findMany).mockResolvedValue([] as never);
  vi.mocked(prisma.shot.findMany).mockResolvedValue([] as never);
  vi.mocked(prisma.asset.findMany).mockResolvedValue([] as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.project.findMany).mockResolvedValue([{ id: 7 }] as never);
  emptyTables();
});

describe('applyRules', () => {
  it('masque les plans qui tombent sous la règle, en une écriture groupée', async () => {
    vi.mocked(prisma.visibilityRule.findMany).mockResolvedValue([rule()] as never);
    vi.mocked(prisma.shot.findMany).mockResolvedValue([
      { id: 10, code: 'SH010_TMP', name: 'SH010_TMP', hiddenRuleId: null },
      { id: 11, code: 'SH011_TMP', name: 'SH011_TMP', hiddenRuleId: null },
      { id: 12, code: 'SH012', name: 'SH012', hiddenRuleId: null },
    ] as never);

    const result = await applyRules(1);

    expect(result.hidden).toBe(2);
    expect(prisma.shot.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: [10, 11] } },
        data: expect.objectContaining({ hiddenRuleId: 1 }),
      }),
    );
  });

  it('ne réécrit pas un plan que la même règle masque déjà', async () => {
    // Réécrire toucherait `updatedAt` à chaque passe, et la synchronisation ShotGrid en
    // conclurait que ReView a bougé — un faux conflit à chaque import.
    vi.mocked(prisma.visibilityRule.findMany).mockResolvedValue([rule()] as never);
    vi.mocked(prisma.shot.findMany).mockResolvedValue([
      { id: 10, code: 'SH010_TMP', name: 'SH010_TMP', hiddenRuleId: 1 },
    ] as never);

    const result = await applyRules(1);

    expect(result.hidden).toBe(0);
    expect(prisma.shot.updateMany).not.toHaveBeenCalled();
  });

  it("démasque ce qu'aucune règle ne revendique plus", async () => {
    vi.mocked(prisma.visibilityRule.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.shot.findMany).mockResolvedValue([
      { id: 10, code: 'SH010', name: 'SH010', hiddenRuleId: 4 },
    ] as never);

    const result = await applyRules(1);

    expect(result.revealed).toBe(1);
    expect(prisma.shot.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [10] } },
      data: { hiddenAt: null, hiddenRuleId: null, hiddenReason: null },
    });
  });

  it('ne lit jamais ce qui est masqué à la main : le filtre les exclut du lot', async () => {
    vi.mocked(prisma.visibilityRule.findMany).mockResolvedValue([rule()] as never);
    await applyRules(1);
    expect(prisma.shot.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [{ hiddenAt: null }, { hiddenRuleId: { not: null } }],
        }),
      }),
    );
  });

  it("une règle de projet ne s'applique pas aux autres projets", async () => {
    vi.mocked(prisma.project.findMany).mockResolvedValue([{ id: 7 }, { id: 8 }] as never);
    vi.mocked(prisma.visibilityRule.findMany).mockResolvedValue([rule({ projectId: 8 })] as never);
    vi.mocked(prisma.shot.findMany)
      // Projet 7 : la règle ne le concerne pas, son plan reste visible.
      .mockResolvedValueOnce([{ id: 70, code: 'SH_TMP', name: 'SH_TMP', hiddenRuleId: null }] as never)
      .mockResolvedValueOnce([{ id: 80, code: 'SH_TMP', name: 'SH_TMP', hiddenRuleId: null }] as never);

    const result = await applyRules(1);

    expect(result.hidden).toBe(1);
    expect(prisma.shot.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: [80] } } }),
    );
  });

  it('une règle illisible est ignorée sans condamner les autres', async () => {
    vi.mocked(prisma.visibilityRule.findMany).mockResolvedValue([
      rule({ id: 1, matchType: 'regex', pattern: '([a-z' }),
      rule({ id: 2, matchType: 'contains', pattern: '_TMP' }),
    ] as never);
    vi.mocked(prisma.shot.findMany).mockResolvedValue([
      { id: 10, code: 'SH010_TMP', name: 'SH010_TMP', hiddenRuleId: null },
    ] as never);

    const result = await applyRules(1);

    expect(result.hidden).toBe(1);
    expect(prisma.shot.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ hiddenRuleId: 2 }) }),
    );
  });
});

describe('createRule', () => {
  it('refuse une expression invalide avant de rien écrire', async () => {
    await expect(
      createRule(1, 3, { entityType: 'shot', matchType: 'regex', pattern: '([a-z' }),
    ).rejects.toThrow(/invalid/i);
    expect(prisma.visibilityRule.create).not.toHaveBeenCalled();
  });

  it('refuse un type inconnu', async () => {
    await expect(
      // @ts-expect-error — cas d'un appelant qui contourne le schéma Zod de la route.
      createRule(1, 3, { entityType: 'version', matchType: 'exact', pattern: 'x' }),
    ).rejects.toThrow();
    expect(prisma.visibilityRule.create).not.toHaveBeenCalled();
  });
});

describe('setHidden', () => {
  it("masque à la main sans attribuer de règle — c'est ce qui protège la décision", async () => {
    await setHidden('shot', 42, true, 'plan de recette');
    expect(prisma.shot.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [42] } },
      data: expect.objectContaining({ hiddenRuleId: null, hiddenReason: 'plan de recette' }),
    });
  });

  it('révèle en effaçant les trois colonnes ensemble', async () => {
    await setHidden('asset', 9, false);
    expect(prisma.asset.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [9] } },
      data: { hiddenAt: null, hiddenReason: null, hiddenRuleId: null },
    });
  });
});
