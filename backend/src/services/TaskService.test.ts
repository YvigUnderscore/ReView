// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/prisma', () => ({
  prisma: {
    task: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
    comment: { findUnique: vi.fn() },
    // Garde de suppression (Phase 50) : `Version.taskId` est en cascade — une tâche qui
    // porte des versions ne se supprime pas. Vide par défaut.
    version: { count: vi.fn().mockResolvedValue(0) },
    // Verrou d'archivage (38.B) : projet ouvert par défaut.
    project: { findFirst: vi.fn().mockResolvedValue({ status: 'ACTIVE' }) },
    // Les droits se lisent sur le rôle EFFECTIF (38.E) : par défaut, membre sans rôle local
    // (donc jugé sur son rôle global), ce que testaient déjà les cas ci-dessous.
    projectMembership: { findUnique: vi.fn().mockResolvedValue({ role: null }) },
    // Politique de département (réglage studio) : absente = « open », la règle historique.
    setting: { findUnique: vi.fn().mockResolvedValue(null) },
    user: { findUnique: vi.fn().mockResolvedValue({ departments: [] }) },
  },
}));
vi.mock('./SocketService', () => ({ emitToProject: vi.fn() }));
vi.mock('./NotificationService', () => ({ notify: vi.fn() }));
vi.mock('./DepartmentService', () => ({ resolveByKey: vi.fn().mockResolvedValue(null) }));
vi.mock('./PipelineStatusService', () => ({
  listForProject: vi.fn().mockResolvedValue([]),
  resolveByLegacy: vi.fn().mockResolvedValue(null),
}));
vi.mock('./shotgrid/ShotgridPushService', () => ({ enqueuePush: vi.fn() }));

import { createFromComment, taskNameFromComment, update, remove } from './TaskService';
import { prisma } from '../lib/prisma';
import { notify } from './NotificationService';
import * as DepartmentService from './DepartmentService';
import * as PipelineStatusService from './PipelineStatusService';
import { enqueuePush } from './shotgrid/ShotgridPushService';
import { Prisma, Role, TaskStatus } from '@prisma/client';

const supervisor = { id: 2, role: Role.SUPERVISOR };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.task.create).mockResolvedValue({
    id: 50,
    name: 'n',
    shotId: 7,
    assetId: null,
  } as never);
});

describe('taskNameFromComment (32.D)', () => {
  it('déshabille le HTML, compacte les espaces et tronque à 80', () => {
    expect(taskNameFromComment('<b>corriger</b>\n  le  reflet')).toBe('corriger le reflet');
    const long = 'x'.repeat(120);
    expect(taskNameFromComment(long)).toHaveLength(80);
    expect(taskNameFromComment(long).endsWith('…')).toBe(true);
  });
  /**
   * Le repli est rédigé en ANGLAIS : la base l'est, et un nom stocké en français
   * s'affichait tel quel dans les quatorze langues de l'interface.
   */
  it('fallback anglais pour un commentaire sans texte', () => {
    expect(taskNameFromComment('<img src="x">')).toBe('Review feedback');
  });
});

describe('createFromComment (32.D)', () => {
  it('rattache la tâche au shot de la version et reprend l’assigné', async () => {
    vi.mocked(prisma.comment.findUnique).mockResolvedValue({
      id: 9,
      content: 'corriger le reflet',
      assigneeId: 4,
      media: { version: { assetId: null, task: { shotId: 7, assetId: null } } },
    } as never);
    await createFromComment(supervisor, 3, 9);
    expect(prisma.task.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: 'corriger le reflet',
          shotId: 7,
          assetId: null,
          assigneeId: 4,
          sourceCommentId: 9,
        }),
      }),
    );
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ userId: 4, kind: 'taskAssigned' }));
  });

  it('version d’asset direct : tâche rattachée à l’asset', async () => {
    vi.mocked(prisma.comment.findUnique).mockResolvedValue({
      id: 9,
      content: 'ok',
      assigneeId: null,
      media: { version: { assetId: 12, task: null } },
    } as never);
    await createFromComment(supervisor, 3, 9);
    expect(prisma.task.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ shotId: null, assetId: 12 }) }),
    );
    expect(notify).not.toHaveBeenCalled();
  });

  it('400 si le média n’a ni shot ni asset, 404 si commentaire inconnu', async () => {
    vi.mocked(prisma.comment.findUnique).mockResolvedValue({
      id: 9,
      content: 'x',
      assigneeId: null,
      media: { version: { assetId: null, task: null } },
    } as never);
    await expect(createFromComment(supervisor, 3, 9)).rejects.toMatchObject({ statusCode: 400 });
    vi.mocked(prisma.comment.findUnique).mockResolvedValue(null);
    await expect(createFromComment(supervisor, 3, 99)).rejects.toMatchObject({ statusCode: 404 });
  });
});

/**
 * Ce chemin ne vérifiait RIEN : ni les droits (la route les lisait sur le rôle global), ni
 * l'archivage, et la tâche naissait sans étape ni statut de référentiel — donc dans la
 * colonne de repli du kanban (Phase 50, lot 5).
 */
describe('createFromComment — gardes et complétude (Phase 50)', () => {
  const artist = { id: 4, role: Role.ARTIST };
  const onComp = {
    id: 9,
    content: 'corriger le reflet',
    assigneeId: null,
    media: {
      version: { assetId: null, task: { shotId: 7, assetId: null, type: 'COMP', department: 'comp' } },
    },
  };

  beforeEach(() => {
    vi.mocked(prisma.comment.findUnique).mockResolvedValue(onComp as never);
    vi.mocked(prisma.projectMembership.findUnique).mockResolvedValue({ role: null } as never);
    vi.mocked(prisma.project.findFirst).mockResolvedValue({ status: 'ACTIVE' } as never);
    vi.mocked(DepartmentService.resolveByKey).mockResolvedValue(null);
    vi.mocked(PipelineStatusService.resolveByLegacy).mockResolvedValue(null);
  });

  it('un ARTIST est refusé (403), le superviseur DU PROJET est accepté', async () => {
    await expect(createFromComment(artist, 3, 9)).rejects.toMatchObject({ statusCode: 403 });
    expect(prisma.task.create).not.toHaveBeenCalled();
    vi.mocked(prisma.projectMembership.findUnique).mockResolvedValue({ role: Role.SUPERVISOR } as never);
    await createFromComment(artist, 3, 9);
    expect(prisma.task.create).toHaveBeenCalled();
  });

  it('refuse un projet archivé (38.B)', async () => {
    vi.mocked(prisma.project.findFirst).mockResolvedValue({ status: 'ARCHIVED' } as never);
    await expect(createFromComment(supervisor, 3, 9)).rejects.toMatchObject({ statusCode: 403 });
    expect(prisma.task.create).not.toHaveBeenCalled();
  });

  it('hérite de l’étape et du statut d’entrée du référentiel du projet', async () => {
    vi.mocked(DepartmentService.resolveByKey).mockResolvedValue({ id: 6, key: 'comp' } as never);
    vi.mocked(PipelineStatusService.resolveByLegacy).mockResolvedValue({
      id: 31,
      legacyStatus: TaskStatus.TODO,
    } as never);
    await createFromComment(supervisor, 3, 9);
    expect(prisma.task.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          department: 'comp',
          departmentId: 6,
          pipelineStatusId: 31,
          status: TaskStatus.TODO,
          type: 'COMP',
        }),
      }),
    );
  });

  it('prend le nom du dialogue, et la consigne avec', async () => {
    await createFromComment(supervisor, 3, 9, { name: '  Flicker sur le halo  ', description: ' à revoir ' });
    expect(prisma.task.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ name: 'Flicker sur le halo', description: 'à revoir' }),
      }),
    );
  });

  it('un nom vide retombe sur le texte du commentaire', async () => {
    await createFromComment(supervisor, 3, 9, { name: '   ' });
    expect(prisma.task.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ name: 'corriger le reflet' }) }),
    );
  });

  it('409 nommé quand l’étape porte déjà ce nom, plutôt qu’une erreur interne', async () => {
    const unique = Object.assign(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: '5',
      }),
    );
    vi.mocked(prisma.task.create).mockRejectedValueOnce(unique);
    await expect(createFromComment(supervisor, 3, 9)).rejects.toMatchObject({
      statusCode: 409,
      code: 'TASK_NAME_TAKEN',
    });
  });

  it('demande la création de la tâche sur le site ShotGrid', async () => {
    await createFromComment(supervisor, 3, 9);
    expect(enqueuePush).toHaveBeenCalledWith(3, expect.objectContaining({ type: 'task-create', taskId: 50 }));
  });
});

/**
 * `Version.taskId` est en `onDelete: Cascade` : sans garde, exposer « Supprimer » au clic
 * droit du kanban détruisait des versions et des médias publiés (Phase 50, lot 5).
 */
describe('remove — garde des versions (Phase 50)', () => {
  beforeEach(() => {
    vi.mocked(prisma.task.findUnique).mockResolvedValue({ shotId: 7, assetId: null } as never);
  });

  it('refuse (409) une tâche qui porte des versions, et dit combien', async () => {
    vi.mocked(prisma.version.count).mockResolvedValue(3);
    await expect(remove(supervisor, 3, 1)).rejects.toMatchObject({
      statusCode: 409,
      code: 'TASK_HAS_VERSIONS',
      details: { count: 3 },
    });
    expect(prisma.task.delete).not.toHaveBeenCalled();
  });

  it('supprime une tâche vide', async () => {
    vi.mocked(prisma.version.count).mockResolvedValue(0);
    await remove(supervisor, 3, 1);
    expect(prisma.task.delete).toHaveBeenCalledWith({ where: { id: 1 } });
  });
});

describe('update — checklist & droits (38.F)', () => {
  const artist = { id: 4, role: Role.ARTIST };
  beforeEach(() => {
    vi.mocked(prisma.task.update).mockResolvedValue({
      id: 1,
      name: 'n',
      shotId: 7,
      assetId: null,
    } as never);
  });

  it('l’assigné peut cocher la checklist de sa tâche', async () => {
    vi.mocked(prisma.task.findUnique).mockResolvedValue({ assigneeId: 4 } as never);
    await update(artist, 3, 1, { checklist: [{ text: 'a', done: true }] });
    expect(prisma.task.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ checklist: [{ text: 'a', done: true }] }) }),
    );
  });

  it('un non-assigné non-manager ne peut pas modifier la checklist (403)', async () => {
    vi.mocked(prisma.task.findUnique).mockResolvedValue({ assigneeId: 99 } as never);
    await expect(update(artist, 3, 1, { checklist: [] })).rejects.toMatchObject({ statusCode: 403 });
    expect(prisma.task.update).not.toHaveBeenCalled();
  });
});

/**
 * Le modèle d'autorisation est celui du rôle EFFECTIF sur le projet (38.E). Le modèle
 * concurrent — un `isGlobalManager(user.role)` recopié dans le service — refusait au
 * superviseur nommé sur CE projet d'y renommer ou d'y supprimer une tâche.
 */
describe('rôle effectif du projet (38.E)', () => {
  const artist = { id: 4, role: Role.ARTIST };
  const membership = vi.mocked(prisma.projectMembership.findUnique);

  beforeEach(() => {
    membership.mockResolvedValue({ role: null } as never);
    vi.mocked(prisma.task.update).mockResolvedValue({
      id: 1,
      name: 'n',
      shotId: 7,
      assetId: null,
    } as never);
  });

  it('ARTIST promu SUPERVISOR sur le projet renomme une tâche qui ne lui est pas assignée', async () => {
    membership.mockResolvedValue({ role: Role.SUPERVISOR } as never);
    vi.mocked(prisma.task.findUnique).mockResolvedValue({ assigneeId: 99 } as never);
    await update(artist, 3, 1, { name: 'Nouveau nom' });
    expect(prisma.task.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ name: 'Nouveau nom' }) }),
    );
  });

  it('ARTIST promu SUPERVISOR sur le projet supprime une tâche', async () => {
    membership.mockResolvedValue({ role: Role.SUPERVISOR } as never);
    vi.mocked(prisma.task.findUnique).mockResolvedValue({ shotId: 7, assetId: null } as never);
    await remove(artist, 3, 1);
    expect(prisma.task.delete).toHaveBeenCalledWith({ where: { id: 1 } });
  });

  it('ARTIST sans élévation locale ne supprime pas (403)', async () => {
    await expect(remove(artist, 3, 1)).rejects.toMatchObject({ statusCode: 403 });
    expect(prisma.task.delete).not.toHaveBeenCalled();
  });
});
