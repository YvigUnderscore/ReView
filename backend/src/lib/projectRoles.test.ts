// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./prisma', () => ({
  prisma: { projectMembership: { findUnique: vi.fn() } },
}));

import {
  effectiveProjectRole,
  canManageProject,
  canContribute,
  isGlobalManager,
  isProjectManager,
  assertProjectManage,
  assertCanContribute,
} from './projectRoles';
import { prisma } from './prisma';
import { Role } from '@prisma/client';

const findUnique = vi.mocked(prisma.projectMembership.findUnique);

beforeEach(() => vi.clearAllMocks());

describe('projectRoles.effectiveProjectRole (38.E)', () => {
  it('global ADMIN: ADMIN everywhere, without querying membership', async () => {
    expect(await effectiveProjectRole(1, Role.ADMIN, 9)).toBe(Role.ADMIN);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('global SUPERVISOR: SUPERVISOR (global access, membership ignored)', async () => {
    expect(await effectiveProjectRole(1, Role.SUPERVISOR, 9)).toBe(Role.SUPERVISOR);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('non-global role without membership: no access (null)', async () => {
    findUnique.mockResolvedValue(null);
    expect(await effectiveProjectRole(2, Role.ARTIST, 9)).toBeNull();
  });

  it('membership without role: inherits the global role', async () => {
    findUnique.mockResolvedValue({ role: null } as never);
    expect(await effectiveProjectRole(2, Role.ARTIST, 9)).toBe(Role.ARTIST);
  });

  it('local elevation: global ARTIST + SUPERVISOR membership → SUPERVISOR', async () => {
    findUnique.mockResolvedValue({ role: Role.SUPERVISOR } as never);
    expect(await effectiveProjectRole(2, Role.ARTIST, 9)).toBe(Role.SUPERVISOR);
  });
});

describe('projectRoles — helpers & assertions', () => {
  it('canManageProject / canContribute', () => {
    expect(canManageProject(Role.SUPERVISOR)).toBe(true);
    expect(canManageProject(Role.ARTIST)).toBe(false);
    expect(canManageProject(null)).toBe(false);
    expect(canContribute(Role.ARTIST)).toBe(true);
    expect(canContribute(Role.CLIENT)).toBe(false);
    expect(canContribute(null)).toBe(false);
  });

  it('isGlobalManager reads only the global role (use outside a project)', () => {
    expect(isGlobalManager(Role.ADMIN)).toBe(true);
    expect(isGlobalManager(Role.SUPERVISOR)).toBe(true);
    expect(isGlobalManager(Role.ARTIST)).toBe(false);
    expect(isGlobalManager(Role.CLIENT)).toBe(false);
  });

  it('isProjectManager follows the local elevation, where isGlobalManager ignored it', async () => {
    findUnique.mockResolvedValue({ role: Role.SUPERVISOR } as never);
    expect(await isProjectManager(2, Role.ARTIST, 9)).toBe(true);
    expect(isGlobalManager(Role.ARTIST)).toBe(false); // the former model said no
  });

  it('isProjectManager also follows the local demotion', async () => {
    findUnique.mockResolvedValue({ role: Role.CLIENT } as never);
    expect(await isProjectManager(2, Role.ARTIST, 9)).toBe(false);
    // A global manager stays a manager everywhere: a local demotion does not trap them.
    expect(await isProjectManager(1, Role.SUPERVISOR, 9)).toBe(true);
  });

  it('assertProjectManage refuses a local artist (403)', async () => {
    findUnique.mockResolvedValue({ role: null } as never);
    await expect(assertProjectManage(2, Role.ARTIST, 9)).rejects.toMatchObject({ statusCode: 403 });
  });

  it('assertCanContribute refuses a CLIENT (403 ROLE_FORBIDDEN)', async () => {
    findUnique.mockResolvedValue({ role: Role.CLIENT } as never);
    await expect(assertCanContribute(2, Role.ARTIST, 9)).rejects.toMatchObject({
      statusCode: 403,
      code: 'ROLE_FORBIDDEN',
    });
  });
});
