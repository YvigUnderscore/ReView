import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./prisma', () => ({
  prisma: { projectMembership: { findUnique: vi.fn() } },
}));

import {
  effectiveProjectRole,
  canManageProject,
  canContribute,
  assertProjectManage,
  assertCanContribute,
} from './projectRoles';
import { prisma } from './prisma';
import { Role } from '@prisma/client';

const findUnique = vi.mocked(prisma.projectMembership.findUnique);

beforeEach(() => vi.clearAllMocks());

describe('projectRoles.effectiveProjectRole (38.E)', () => {
  it('ADMIN global : ADMIN partout, sans interroger le membership', async () => {
    expect(await effectiveProjectRole(1, Role.ADMIN, 9)).toBe(Role.ADMIN);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('SUPERVISOR global : SUPERVISOR (accès global, membership ignoré)', async () => {
    expect(await effectiveProjectRole(1, Role.SUPERVISOR, 9)).toBe(Role.SUPERVISOR);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('rôle non-global sans membership : aucun accès (null)', async () => {
    findUnique.mockResolvedValue(null as never);
    expect(await effectiveProjectRole(2, Role.ARTIST, 9)).toBeNull();
  });

  it('membership sans rôle : hérite du rôle global', async () => {
    findUnique.mockResolvedValue({ role: null } as never);
    expect(await effectiveProjectRole(2, Role.ARTIST, 9)).toBe(Role.ARTIST);
  });

  it('élévation locale : ARTIST global + membership SUPERVISOR → SUPERVISOR', async () => {
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

  it('assertProjectManage refuse un artiste local (403)', async () => {
    findUnique.mockResolvedValue({ role: null } as never);
    await expect(assertProjectManage(2, Role.ARTIST, 9)).rejects.toMatchObject({ statusCode: 403 });
  });

  it('assertCanContribute refuse un CLIENT (403 ROLE_FORBIDDEN)', async () => {
    findUnique.mockResolvedValue({ role: Role.CLIENT } as never);
    await expect(assertCanContribute(2, Role.ARTIST, 9)).rejects.toMatchObject({
      statusCode: 403,
      code: 'ROLE_FORBIDDEN',
    });
  });
});
