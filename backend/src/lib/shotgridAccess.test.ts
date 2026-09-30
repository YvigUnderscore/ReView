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

describe('assertProjectManager — projet mis à la corbeille', () => {
  /**
   * Ces écrans ne font pas que lire : ils déclenchent des synchronisations, donc des
   * écritures sur le site ShotGrid du studio. Un projet retiré doit y être aussi
   * inatteignable qu'ailleurs — la garde interrogeait le projet sans regarder `deletedAt`.
   */
  it('interroge le projet en excluant la corbeille', async () => {
    await assertProjectManager(admin, 12);
    expect(db.project.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 12, deletedAt: null }) }),
    );
  });

  it('refuse un projet à la corbeille, même à un administrateur', async () => {
    // Le filtre `deletedAt: null` ne rend rien pour un projet retiré.
    db.project.findUnique.mockResolvedValue(null);
    await expect(assertProjectManager(admin, 12)).rejects.toThrow(/Project not found/);
  });

  it('refuse avant même de regarder l’appartenance', async () => {
    db.project.findUnique.mockResolvedValue(null);
    await expect(assertProjectManager(superviseur, 12)).rejects.toThrow(/Project not found/);
    expect(db.projectMembership.findUnique).not.toHaveBeenCalled();
  });

  it('rend le même refus qu’un projet qui n’a jamais existé', async () => {
    db.project.findUnique.mockResolvedValue(null);
    const retire = await assertProjectManager(admin, 12).catch((e: Error) => e.message);
    const inexistant = await assertProjectManager(admin, 999).catch((e: Error) => e.message);
    expect(retire).toBe(inexistant);
  });

  it('laisse passer un projet vivant', async () => {
    await expect(assertProjectManager(superviseur, 12)).resolves.toBeUndefined();
  });
});

describe('assertProjectManager — rôles', () => {
  it('accepte un administrateur sans consulter l’appartenance', async () => {
    await assertProjectManager(admin, 12);
    expect(db.projectMembership.findUnique).not.toHaveBeenCalled();
  });

  it('refuse un non-membre', async () => {
    db.projectMembership.findUnique.mockResolvedValue(null);
    await expect(assertProjectManager(artiste, 12)).rejects.toThrow(/No access to this project/);
  });

  it('refuse un membre qui n’est pas superviseur', async () => {
    db.projectMembership.findUnique.mockResolvedValue({ role: Role.ARTIST });
    await expect(assertProjectManager(artiste, 12)).rejects.toThrow(/Supervisors and administrators only/);
  });

  // L'élévation locale (10.D8) : le rôle porté par l'appartenance prime sur le rôle global.
  it('accepte un artiste promu superviseur sur ce projet', async () => {
    db.projectMembership.findUnique.mockResolvedValue({ role: Role.SUPERVISOR });
    await expect(assertProjectManager(artiste, 12)).resolves.toBeUndefined();
  });

  it('adminOnly écarte le superviseur', async () => {
    await expect(assertProjectManager(superviseur, 12, { adminOnly: true })).rejects.toThrow(
      /Administrators only/,
    );
    await expect(assertProjectManager(admin, 12, { adminOnly: true })).resolves.toBeUndefined();
  });

  it('allowMembers ouvre aux membres mais jamais au client', async () => {
    db.projectMembership.findUnique.mockResolvedValue({ role: Role.ARTIST });
    await expect(assertProjectManager(artiste, 12, { allowMembers: true })).resolves.toBeUndefined();

    db.projectMembership.findUnique.mockResolvedValue({ role: Role.CLIENT });
    await expect(assertProjectManager(artiste, 12, { allowMembers: true })).rejects.toThrow(/Access denied/);
  });
});

describe('canManageShotgrid', () => {
  it('rend false plutôt que de lever, corbeille comprise', async () => {
    db.project.findUnique.mockResolvedValue(null);
    await expect(canManageShotgrid(admin, 12)).resolves.toBe(false);
  });

  it('rend true pour un superviseur membre d’un projet vivant', async () => {
    await expect(canManageShotgrid(superviseur, 12)).resolves.toBe(true);
  });
});
