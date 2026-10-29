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

/** No entity anywhere, except for the type a test explicitly feeds. */
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
  it('hides the shots that fall under the rule, in one grouped write', async () => {
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

  it('does not rewrite a shot that the same rule already hides', async () => {
        // Rewriting would touch `updatedAt` on every pass, and ShotGrid synchronization would conclude that
        // ReView had changed: a false conflict on every import.
    vi.mocked(prisma.visibilityRule.findMany).mockResolvedValue([rule()] as never);
    vi.mocked(prisma.shot.findMany).mockResolvedValue([
      { id: 10, code: 'SH010_TMP', name: 'SH010_TMP', hiddenRuleId: 1 },
    ] as never);

    const result = await applyRules(1);

    expect(result.hidden).toBe(0);
    expect(prisma.shot.updateMany).not.toHaveBeenCalled();
  });

  it("unhides what no rule claims any more", async () => {
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

  it('never reads what is hidden by hand: the filter excludes them from the batch', async () => {
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

  it("a project rule does not apply to other projects", async () => {
    vi.mocked(prisma.project.findMany).mockResolvedValue([{ id: 7 }, { id: 8 }] as never);
    vi.mocked(prisma.visibilityRule.findMany).mockResolvedValue([rule({ projectId: 8 })] as never);
    vi.mocked(prisma.shot.findMany)
            // Project 7: the rule does not concern it, its shot stays visible.
      .mockResolvedValueOnce([{ id: 70, code: 'SH_TMP', name: 'SH_TMP', hiddenRuleId: null }] as never)
      .mockResolvedValueOnce([{ id: 80, code: 'SH_TMP', name: 'SH_TMP', hiddenRuleId: null }] as never);

    const result = await applyRules(1);

    expect(result.hidden).toBe(1);
    expect(prisma.shot.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: [80] } } }),
    );
  });

  it('an unreadable rule is ignored without condemning the others', async () => {
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
  it('refuses an invalid expression before writing anything', async () => {
    await expect(
      createRule(1, 3, { entityType: 'shot', matchType: 'regex', pattern: '([a-z' }),
    ).rejects.toThrow(/invalid/i);
    expect(prisma.visibilityRule.create).not.toHaveBeenCalled();
  });

  it('refuses an unknown type', async () => {
    await expect(
            // @ts-expect-error: a caller bypassing the route's Zod schema.
      createRule(1, 3, { entityType: 'version', matchType: 'exact', pattern: 'x' }),
    ).rejects.toThrow();
    expect(prisma.visibilityRule.create).not.toHaveBeenCalled();
  });
});

describe('setHidden', () => {
  it("hides by hand without assigning a rule: this is what protects the decision", async () => {
    await setHidden('shot', 42, true, 'plan de recette');
    expect(prisma.shot.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [42] } },
      data: expect.objectContaining({ hiddenRuleId: null, hiddenReason: 'plan de recette' }),
    });
  });

  it('reveals by clearing the three columns together', async () => {
    await setHidden('asset', 9, false);
    expect(prisma.asset.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [9] } },
      data: { hiddenAt: null, hiddenReason: null, hiddenRuleId: null },
    });
  });
});
