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
import { myOpenTasksWhere, myRetakesWhere, taskOfProject } from '../lib/homeScope';
import type { PaginationParams } from '../lib/pagination';

/**
 * The two cross-cutting views that unfold the Home page counters.
 *
 * What is checked here is not that they return rows, but that they return the rows OF THE COUNTER: they must
 * apply exactly the `where` of the card that opens them. A scope copied by hand would drift, and the page
 * would show something other than the clicked figure — the defect being corrected here, in another form.
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
  it('applies the scope of the clicked counter: "my retakes" for scope=blocked', async () => {
    await listMyTasks(artist, 'blocked', p);
    expect(tasks.mock.calls[0]![0]!.where).toEqual(myRetakesWhere(artist));
    expect(vi.mocked(prisma.task.count).mock.calls[0]![0]!.where).toEqual(myRetakesWhere(artist));
  });

  it('without a scope, all my live tasks — same bounds, another family', async () => {
    await listMyTasks(artist, 'all', p);
    expect(tasks.mock.calls[0]![0]!.where).toEqual(myOpenTasksWhere(artist));
  });

  it('names the project and the location: the page is cross-cutting, the project is part of the location', async () => {
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

  it('sorts by deadline, tasks without a date at the end, `id` as tie-break', async () => {
    // Without a tie-break, two tasks without a deadline could change page from one request to the next:
    // pagination would redisplay rows and skip others.
    await listMyTasks(artist, 'all', p);
    expect(tasks.mock.calls[0]![0]!.orderBy).toEqual([
      { dueDate: { sort: 'asc', nulls: 'last' } },
      { id: 'desc' },
    ]);
  });

  it('adds the project as a RESTRICTION, without touching the counter\'s scope', async () => {
    // The "my tasks" block of an overview shows the same list, seen through the hole of a project. Composing
    // with `AND` is what guarantees that a filter can never open what the scope closes.
    await listMyTasks(artist, 'all', p, 12);
    expect(tasks.mock.calls[0]![0]!.where).toEqual({
      AND: [myOpenTasksWhere(artist), taskOfProject(12)],
    });
  });
});

describe('listMyComments', () => {
  it('bounds a CLIENT to the notes meant for them', async () => {
    await listMyComments(client, p);
    const where = JSON.stringify(notes.mock.calls[0]![0]!.where);
    expect(where).toContain('"isVisibleToClient":true');
  });

  it('returns one row per note, with its location and its author (guest included)', async () => {
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

  it('does not fetch the heavy columns (trace, 3D viewpoint, attachments)', async () => {
    await listMyComments(artist, p);
    const columns = JSON.stringify(notes.mock.calls[0]![0]!.select);
    expect(columns).not.toContain('annotation');
    expect(columns).not.toContain('cameraState');
    expect(columns).not.toContain('attachments');
  });
});
