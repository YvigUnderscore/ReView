// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Départements d'un membre sur un projet (lot 10).
 *
 * Deux invariants sont figés ici, et ils protègent des données qu'on ne rattrape pas.
 *
 * 1. **Jamais de `set`.** Depuis l'onglet Membres on ne voit que le vocabulaire d'un
 *    projet ; remplacer la liste entière effacerait en silence les départements que la
 *    personne tient d'un autre projet ou du référentiel studio.
 * 2. **Les identifiants sont vérifiés dans les deux sens.** Un identifiant pris ailleurs
 *    ne doit ni s'ajouter ni, surtout, se retirer — décrocher quelqu'un d'un projet qu'on
 *    ne regarde même pas serait invisible jusqu'à ce que son travail disparaisse des
 *    filtres.
 */
const { db, logAudit } = vi.hoisted(() => ({
  db: {
    projectMembership: { findUnique: vi.fn() },
    project: { findUnique: vi.fn() },
    department: { findMany: vi.fn() },
    user: { update: vi.fn(), findUnique: vi.fn() },
  },
  logAudit: vi.fn(),
}));

vi.mock('../lib/prisma', () => ({ prisma: db }));
vi.mock('./AuditService', () => ({ logAudit }));
vi.mock('./StorageService', () => ({
  storage: { getPresignedGetUrl: vi.fn(), getPresignedPutUrl: vi.fn(), forgetPresignedUrl: vi.fn() },
  StorageService: { departmentImageKey: vi.fn() },
}));

import { setMemberDepartments } from './DepartmentService';

const ACTOR = { id: 1 };

beforeEach(() => {
  vi.clearAllMocks();
  db.projectMembership.findUnique.mockResolvedValue({ id: 42 });
  db.project.findUnique.mockResolvedValue({ studioId: 1 });
  // Vocabulaire du projet 7 : une étape propre, une étape héritée du studio.
  db.department.findMany.mockResolvedValue([{ id: 10 }, { id: 11 }]);
  db.user.update.mockResolvedValue({});
  db.user.findUnique.mockResolvedValue({ departments: [{ id: 10, key: 'COMP', name: 'Compositing' }] });
});

describe('setMemberDepartments', () => {
  it('refuse une personne qui n’est pas membre du projet', async () => {
    db.projectMembership.findUnique.mockResolvedValue(null);
    await expect(setMemberDepartments(ACTOR, 7, 5, { add: [10] })).rejects.toThrow();
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it('coche et décoche nommément, sans jamais remplacer la liste', async () => {
    await setMemberDepartments(ACTOR, 7, 5, { add: [10], remove: [11] });
    const data = db.user.update.mock.calls[0]![0].data as {
      departments: Record<string, unknown>;
    };
    expect(data.departments).toEqual({ connect: [{ id: 10 }], disconnect: [{ id: 11 }] });
    // Le jour où un `set` réapparaîtrait, les départements des autres projets partiraient
    // avec — d'où l'assertion explicite.
    expect(data.departments).not.toHaveProperty('set');
  });

  it('refuse un département étranger au projet, à l’ajout comme au retrait', async () => {
    await expect(setMemberDepartments(ACTOR, 7, 5, { add: [99] })).rejects.toThrow();
    await expect(setMemberDepartments(ACTOR, 7, 5, { remove: [99] })).rejects.toThrow();
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it('fait primer l’ajout sur le retrait quand le même identifiant figure des deux côtés', async () => {
    // Deux bascules rapides dans un menu : le lot ne doit pas s'annuler lui-même.
    await setMemberDepartments(ACTOR, 7, 5, { add: [10], remove: [10] });
    const data = db.user.update.mock.calls[0]![0].data as {
      departments: { connect: unknown[]; disconnect: unknown[] };
    };
    expect(data.departments.connect).toEqual([{ id: 10 }]);
    expect(data.departments.disconnect).toEqual([]);
  });

  it('n’écrit ni ne consigne rien quand le lot est vide', async () => {
    await setMemberDepartments(ACTOR, 7, 5, {});
    expect(db.user.update).not.toHaveBeenCalled();
    expect(logAudit).not.toHaveBeenCalled();
  });

  it('rend la liste du membre bornée au vocabulaire du projet, et consigne le geste', async () => {
    const out = await setMemberDepartments(ACTOR, 7, 5, { add: [10] });
    expect(out).toEqual([{ id: 10, key: 'COMP', name: 'Compositing' }]);
    expect(db.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        select: {
          departments: expect.objectContaining({
            where: { deletedAt: null, OR: [{ projectId: 7 }, { projectId: null }] },
          }),
        },
      }),
    );
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'PROJECT_MEMBER_DEPARTMENTS', entityId: 7 }),
    );
  });
});
