// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Role } from '@prisma/client';

vi.mock('../lib/prisma', () => ({
  prisma: {
    episode: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    sequence: { findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    shot: { findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    asset: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    task: { findMany: vi.fn() },
    user: { findMany: vi.fn() },
  },
}));
vi.mock('../lib/projectGuard', () => ({ assertProjectWritable: vi.fn() }));
vi.mock('../lib/projectRoles', () => ({
  assertProjectManage: vi.fn(),
  canContribute: (role: Role) => role !== Role.CLIENT,
  effectiveProjectRole: vi.fn(async (_id: number, role: Role) => role),
}));
vi.mock('./SocketService', () => ({ emitToProject: vi.fn() }));
// La photo est signée par le service : le test vérifie la forme rendue, pas la signature.
vi.mock('../lib/userView', () => ({ avatarUrl: vi.fn(async (key: string | null) => key && `url:${key}`) }));

import { setAssignees, scopeAssignees } from './EntityAssigneeService';
import { prisma } from '../lib/prisma';
import { emitToProject } from './SocketService';

const person = (id: number, name: string) => ({
  id,
  name,
  firstName: null,
  lastName: null,
  username: null,
  email: `${name}@studio.test`,
  avatarKey: null,
  jobTitle: null,
});

const actor = { id: 1, role: Role.SUPERVISOR };

beforeEach(() => vi.clearAllMocks());

describe('setAssignees', () => {
  beforeEach(() => {
    vi.mocked(prisma.shot.findFirst).mockResolvedValue({ projectId: 7 } as never);
    vi.mocked(prisma.shot.update).mockResolvedValue({ assignees: [person(2, 'alice')] } as never);
  });

  it('remplace la liste et prévient les écrans ouverts', async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: 2, role: Role.ARTIST, isService: false, disabledAt: null },
    ] as never);

    const result = await setAssignees(actor, 'shot', 42, [2]);

    // La clé objet devient une URL signée : les listes rendent déjà cette forme, et deux
    // formes pour la même personne feraient clignoter la photo après l'assignation.
    const { avatarKey: _key, ...expected } = person(2, 'alice');
    expect(result).toEqual([{ ...expected, avatarUrl: null }]);
    expect(prisma.shot.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { assignees: { set: [{ id: 2 }] } } }),
    );
    expect(emitToProject).toHaveBeenCalledWith(7, 'shot:update', { id: 42 });
  });

  it('dédoublonne la liste reçue', async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: 2, role: Role.ARTIST, isService: false, disabledAt: null },
    ] as never);

    await setAssignees(actor, 'shot', 42, [2, 2, 2]);

    expect(prisma.shot.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { assignees: { set: [{ id: 2 }] } } }),
    );
  });

  it('refuse un compte de service', async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: 5, role: Role.ARTIST, isService: true, disabledAt: null },
    ] as never);
    await expect(setAssignees(actor, 'shot', 42, [5])).rejects.toThrow(/service account/i);
  });

  it('refuse un compte désactivé', async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: 5, role: Role.ARTIST, isService: false, disabledAt: new Date() },
    ] as never);
    await expect(setAssignees(actor, 'shot', 42, [5])).rejects.toThrow(/disabled/i);
  });

  it('refuse un client — il commente, il ne livre pas', async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: 5, role: Role.CLIENT, isService: false, disabledAt: null },
    ] as never);
    await expect(setAssignees(actor, 'shot', 42, [5])).rejects.toThrow(/cannot be assigned/i);
  });

  it('vider la liste est licite et ne vérifie personne', async () => {
    vi.mocked(prisma.shot.update).mockResolvedValue({ assignees: [] } as never);
    await setAssignees(actor, 'shot', 42, []);
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it("refuse une entité qui n'existe pas", async () => {
    vi.mocked(prisma.shot.findFirst).mockResolvedValue(null);
    await expect(setAssignees(actor, 'shot', 999, [2])).rejects.toThrow(/not found/i);
  });
});

describe('scopeAssignees', () => {
  it('fusionne les trois origines et range les responsables directs en tête', async () => {
    // Séquence : Bruno responsable direct, Alice sur un plan, Chloé sur une tâche.
    vi.mocked(prisma.sequence.findUnique).mockResolvedValue({
      assignees: [person(3, 'bruno')],
    } as never);
    vi.mocked(prisma.shot.findMany).mockResolvedValue([
      { assignees: [person(2, 'alice')] },
      { assignees: [person(2, 'alice')] },
    ] as never);
    vi.mocked(prisma.sequence.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.task.findMany).mockResolvedValue([{ assignee: person(4, 'chloe') }] as never);

    const list = await scopeAssignees('sequence', 12);

    expect(list.map((p) => p.name)).toEqual(['bruno', 'alice', 'chloe']);
    expect(list[0]!.origins).toEqual(['direct']);
    // Alice apparaît sur deux plans : le décompte sert à la classer devant Chloé.
    expect(list[1]!.count).toBe(2);
  });

  it("n'attribue pas deux fois la même origine à une personne", async () => {
    vi.mocked(prisma.shot.findUnique).mockResolvedValue({ assignees: [person(2, 'alice')] } as never);
    vi.mocked(prisma.task.findMany).mockResolvedValue([
      { assignee: person(2, 'alice') },
      { assignee: person(2, 'alice') },
    ] as never);

    const list = await scopeAssignees('shot', 42);

    expect(list).toHaveLength(1);
    expect(list[0]!.origins).toEqual(['direct', 'task']);
    expect(list[0]!.count).toBe(3);
  });

  it('un plan et un asset n’ont pas d’enfants à interroger', async () => {
    vi.mocked(prisma.asset.findUnique).mockResolvedValue({ assignees: [] } as never);
    vi.mocked(prisma.task.findMany).mockResolvedValue([] as never);

    await scopeAssignees('asset', 5);

    expect(prisma.shot.findMany).not.toHaveBeenCalled();
  });

  it('écarte les plans masqués du périmètre', async () => {
    vi.mocked(prisma.sequence.findUnique).mockResolvedValue({ assignees: [] } as never);
    vi.mocked(prisma.shot.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.sequence.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.task.findMany).mockResolvedValue([] as never);

    await scopeAssignees('sequence', 12);

    expect(prisma.shot.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ hiddenAt: null, deletedAt: null }),
      }),
    );
  });
});
