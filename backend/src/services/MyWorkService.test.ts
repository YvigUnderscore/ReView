// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/prisma', () => ({
  prisma: {
    task: { findMany: vi.fn(), count: vi.fn() },
    comment: { findMany: vi.fn(), count: vi.fn() },
  },
}));

import { Role } from '@prisma/client';
import { listMyComments, listMyTasks } from './MyWorkService';
import { prisma } from '../lib/prisma';
import { myOpenTasksWhere, myRetakesWhere } from '../lib/homeScope';
import type { PaginationParams } from '../lib/pagination';

/**
 * Les deux vues transverses qui déplient les compteurs de l'Accueil.
 *
 * Ce qu'on vérifie ici n'est pas qu'elles rendent des lignes, mais qu'elles rendent les
 * lignes DU compteur : elles doivent poser exactement le `where` de la carte qui les ouvre.
 * Un périmètre recopié à la main dériverait, et la page montrerait autre chose que le
 * chiffre cliqué — le défaut qu'on est en train de corriger, sous une autre forme.
 */

const artist = { id: 3, role: Role.ARTIST };
const client = { id: 8, role: Role.CLIENT };
const p: PaginationParams = { page: 1, pageSize: 50, order: 'desc' };

const tasks = vi.mocked(prisma.task.findMany);
const notes = vi.mocked(prisma.comment.findMany);

beforeEach(() => {
  vi.clearAllMocks();
  tasks.mockResolvedValue([] as never);
  notes.mockResolvedValue([] as never);
  vi.mocked(prisma.task.count).mockResolvedValue(0);
  vi.mocked(prisma.comment.count).mockResolvedValue(0);
});

describe('listMyTasks', () => {
  it('pose le périmètre du compteur cliqué : « mes retakes » pour scope=blocked', async () => {
    await listMyTasks(artist, 'blocked', p);
    expect(tasks.mock.calls[0]![0]!.where).toEqual(myRetakesWhere(artist));
    expect(vi.mocked(prisma.task.count).mock.calls[0]![0]!.where).toEqual(myRetakesWhere(artist));
  });

  it('sans scope, toutes mes tâches vivantes — même bornes, autre famille', async () => {
    await listMyTasks(artist, 'all', p);
    expect(tasks.mock.calls[0]![0]!.where).toEqual(myOpenTasksWhere(artist));
  });

  it('nomme le projet et le lieu : la page est transverse, le projet fait partie du lieu', async () => {
    tasks.mockResolvedValue([
      {
        id: 4,
        name: 'Compositing',
        type: 'COMP',
        status: 'RETAKE',
        dueDate: new Date('2026-09-30T00:00:00Z'),
        shot: { projectId: 7, code: 'SH010', sequence: { code: 'SQ01' }, project: { name: 'Dock' } },
        asset: null,
      },
      {
        id: 5,
        name: 'Modeling',
        type: 'MODELING',
        status: 'TODO',
        dueDate: null,
        shot: null,
        asset: { projectId: 9, name: 'Robot', project: { name: 'Pilot' } },
      },
    ] as never);
    vi.mocked(prisma.task.count).mockResolvedValue(2);
    const { items, total } = await listMyTasks(artist, 'all', p);
    expect(total).toBe(2);
    expect(items[0]).toMatchObject({ location: 'SQ01 · SH010', projectId: 7, projectName: 'Dock' });
    expect(items[1]).toMatchObject({ location: 'Robot', projectId: 9, projectName: 'Pilot' });
  });

  it('trie par échéance, les tâches sans date à la fin, `id` en départage', async () => {
    // Sans départage, deux tâches sans échéance peuvent changer de page d'une requête à
    // l'autre : la pagination réafficherait des lignes et en sauterait d'autres.
    await listMyTasks(artist, 'all', p);
    expect(tasks.mock.calls[0]![0]!.orderBy).toEqual([
      { dueDate: { sort: 'asc', nulls: 'last' } },
      { id: 'desc' },
    ]);
  });
});

describe('listMyComments', () => {
  it('borne un CLIENT aux notes qui lui sont destinées', async () => {
    await listMyComments(client, p);
    const where = JSON.stringify(notes.mock.calls[0]![0]!.where);
    expect(where).toContain('"isVisibleToClient":true');
  });

  it('rend une ligne par note, avec son lieu et son auteur (invité compris)', async () => {
    notes.mockResolvedValue([
      {
        id: 51,
        content: 'À reprendre sur le raccord',
        timestamp: 4.2,
        createdAt: new Date('2026-09-18T10:00:00Z'),
        guestName: 'Client X',
        author: null,
        media: {
          id: 9,
          kind: 'VIDEO',
          originalName: 'sh010_comp.mov',
          version: {
            name: 'V02',
            task: { shot: { code: 'SH010', sequence: { code: 'SQ01' } }, asset: null },
            asset: null,
          },
        },
      },
    ] as never);
    vi.mocked(prisma.comment.count).mockResolvedValue(1);
    const { items } = await listMyComments(artist, p);
    expect(items[0]).toMatchObject({
      id: 51,
      mediaId: 9,
      mediaName: 'sh010_comp.mov',
      location: 'SQ01 · SH010',
      versionName: 'V02',
      author: 'Client X',
    });
  });

  it('ne rapatrie pas les colonnes lourdes (tracé, viewpoint 3D, pièces jointes)', async () => {
    await listMyComments(artist, p);
    const columns = JSON.stringify(notes.mock.calls[0]![0]!.select);
    expect(columns).not.toContain('annotation');
    expect(columns).not.toContain('cameraState');
    expect(columns).not.toContain('attachments');
  });
});
