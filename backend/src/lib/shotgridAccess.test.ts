// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { db } = vi.hoisted(() => ({
  db: { project: { findUnique: vi.fn() }, projectMembership: { findUnique: vi.fn() } },
}));

vi.mock('./prisma', () => ({ prisma: db }));

import { Role } from '@prisma/client';
import { assertProjectManager, canManageShotgrid } from './shotgridAccess';

const admin = { id: 1, role: Role.ADMIN };
const superviseur = { id: 2, role: Role.SUPERVISOR };
const artiste = { id: 3, role: Role.ARTIST };

beforeEach(() => {
  vi.clearAllMocks();
  db.project.findUnique.mockResolvedValue({ id: 12 });
  db.projectMembership.findUnique.mockResolvedValue({ role: Role.SUPERVISOR });
});

describe('assertProjectManager — project put in the trash', () => {
  /**
   * These screens do more than read: they trigger synchronisations, hence writes to the studio's ShotGrid site. A removed project must be as unreachable there as
   * elsewhere — the guard queried the project without looking at `deletedAt`.
   */
  it('queries the project excluding the trash', async () => {
    await assertProjectManager(admin, 12);
    expect(db.project.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 12, deletedAt: null }) }),
    );
  });

  it('refuses a project in the trash, even to an administrator', async () => {
    // The `deletedAt: null` filter returns nothing for a removed project.
    db.project.findUnique.mockResolvedValue(null);
    await expect(assertProjectManager(admin, 12)).rejects.toThrow(/Project not found/);
  });

  it('refuses before even looking at the membership', async () => {
    db.project.findUnique.mockResolvedValue(null);
    await expect(assertProjectManager(superviseur, 12)).rejects.toThrow(/Project not found/);
    expect(db.projectMembership.findUnique).not.toHaveBeenCalled();
  });

  it('returns the same refusal as a project that never existed', async () => {
    db.project.findUnique.mockResolvedValue(null);
    const retire = await assertProjectManager(admin, 12).catch((e: Error) => e.message);
    const inexistant = await assertProjectManager(admin, 999).catch((e: Error) => e.message);
    expect(retire).toBe(inexistant);
  });

  it('lets a live project through', async () => {
    await expect(assertProjectManager(superviseur, 12)).resolves.toBeUndefined();
  });
});

describe('assertProjectManager — roles', () => {
  it('accepts an administrator without consulting the membership', async () => {
    await assertProjectManager(admin, 12);
    expect(db.projectMembership.findUnique).not.toHaveBeenCalled();
  });

  it('refuses a non-member', async () => {
    db.projectMembership.findUnique.mockResolvedValue(null);
    await expect(assertProjectManager(artiste, 12)).rejects.toThrow(/No access to this project/);
  });

  it('refuses a member who is not a supervisor', async () => {
    db.projectMembership.findUnique.mockResolvedValue({ role: Role.ARTIST });
    await expect(assertProjectManager(artiste, 12)).rejects.toThrow(/Supervisors and administrators only/);
  });

  // Local elevation (10.D8): the role carried by the membership takes precedence over the global role.
  it('accepts an artist promoted to supervisor on this project', async () => {
    db.projectMembership.findUnique.mockResolvedValue({ role: Role.SUPERVISOR });
    await expect(assertProjectManager(artiste, 12)).resolves.toBeUndefined();
  });

  it('adminOnly excludes the supervisor', async () => {
    await expect(assertProjectManager(superviseur, 12, { adminOnly: true })).rejects.toThrow(
      /Administrators only/,
    );
    await expect(assertProjectManager(admin, 12, { adminOnly: true })).resolves.toBeUndefined();
  });

  it('allowMembers opens to members but never to the client', async () => {
    db.projectMembership.findUnique.mockResolvedValue({ role: Role.ARTIST });
    await expect(assertProjectManager(artiste, 12, { allowMembers: true })).resolves.toBeUndefined();

    db.projectMembership.findUnique.mockResolvedValue({ role: Role.CLIENT });
    await expect(assertProjectManager(artiste, 12, { allowMembers: true })).rejects.toThrow(/Access denied/);
  });
});

describe('canManageShotgrid', () => {
  it('returns false rather than throwing, trash included', async () => {
    db.project.findUnique.mockResolvedValue(null);
    await expect(canManageShotgrid(admin, 12)).resolves.toBe(false);
  });

  it('returns true for a supervisor member of a live project', async () => {
    await expect(canManageShotgrid(superviseur, 12)).resolves.toBe(true);
  });
});
