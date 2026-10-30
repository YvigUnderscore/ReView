// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { db } = vi.hoisted(() => ({
  db: {
    pipelineStatus: { findMany: vi.fn() },
    shotgridConnection: { findUnique: vi.fn() },
  },
}));

vi.mock('../lib/prisma', () => ({ prisma: db }));

import { assertBelongsToProject, listForProject, resolveByLegacy } from './PipelineStatusService';
import { TaskStatus } from '@prisma/client';

const local = [
  { id: 1, scope: 'task', code: 'todo', origin: 'local', legacyStatus: TaskStatus.TODO },
  { id: 2, scope: 'task', code: 'approved', origin: 'local', legacyStatus: TaskStatus.APPROVED },
];
const site = [
  { id: 10, scope: 'task', code: 'wtg', origin: 'shotgrid', legacyStatus: TaskStatus.TODO },
  { id: 11, scope: 'task', code: 'hld', origin: 'shotgrid', legacyStatus: TaskStatus.TODO },
  { id: 12, scope: 'task', code: 'suprev', origin: 'shotgrid', legacyStatus: TaskStatus.PENDING_REVIEW },
];
const own = [{ id: 20, scope: 'task', code: 'brief', origin: 'local', legacyStatus: TaskStatus.TODO }];

/** Chains the results of `findMany` in the order in which the service requests them. */
const answers = (...lists: unknown[][]) => {
  for (const list of lists) db.pipelineStatus.findMany.mockResolvedValueOnce(list);
};
const whereOf = (call: number) =>
  (db.pipelineStatus.findMany.mock.calls[call]![0] as { where: Record<string, unknown> }).where;

beforeEach(() => vi.clearAllMocks());

/**
 * The reference belongs to the studio, the proposed list belongs to the project. Mixing the two vocabularies
 * invites setting on a ShotGrid project a status that the site will refuse — and offering elsewhere statuses
 * that mean nothing.
 */
describe('listForProject', () => {
  it("serves the project's own vocabulary first", async () => {
    answers(own);
    const r = await listForProject(461, 'task');
    expect(r.map((s) => s.code)).toEqual(['brief']);
    // The studio is not consulted: the project has the last word on the SOURCE. The connection, for its part,
    // now is — it is what carries the statuses retained, and this sort also applies to a vocabulary specific
    // to the project.
    expect(db.pipelineStatus.findMany).toHaveBeenCalledTimes(1);
  });

  it("offers only the site's vocabulary on a linked project", async () => {
    answers([], site);
    db.shotgridConnection.findUnique.mockResolvedValue({ active: true });
    const r = await listForProject(461, 'task');
    expect(r.map((s) => s.code)).toEqual(['wtg', 'hld', 'suprev']);
    expect(whereOf(1)).toMatchObject({ projectId: null, origin: 'shotgrid' });
  });

  it('offers only the local statuses on an unlinked project', async () => {
    answers([], local);
    db.shotgridConnection.findUnique.mockResolvedValue(null);
    const r = await listForProject(448, 'task');
    expect(r.map((s) => s.code)).toEqual(['todo', 'approved']);
    expect(whereOf(1)).toMatchObject({ projectId: null, origin: 'local' });
  });

  it('treats a disabled connection as an absence of connection', async () => {
    // Unlinking a project must not leave its team with the vocabulary of a site to which it no longer has
    // access.
    answers([], local);
    db.shotgridConnection.findUnique.mockResolvedValue({ active: false });
    const r = await listForProject(461, 'task');
    expect(r.map((s) => s.code)).toEqual(['todo', 'approved']);
  });

  it('falls back on the local vocabulary when the site has not yet been read', async () => {
    // A linked project whose statuses have not yet been imported: better the local vocabulary than a selector
    // with no option at all.
    answers([], [], local);
    db.shotgridConnection.findUnique.mockResolvedValue({ active: true });
    const r = await listForProject(461, 'task');
    expect(r.map((s) => s.code)).toEqual(['todo', 'approved']);
  });

  it("NEVER serves a site's vocabulary to an unlinked project", async () => {
    // The default corrected in B2: the fallback returned "the whole reference", site included, to a project
    // that is not linked to it.
    answers([], []);
    db.shotgridConnection.findUnique.mockResolvedValue(null);
    expect(await listForProject(448, 'shot')).toEqual([]);
    // Three calls would have meant that one went looking for one more fallback.
    expect(db.pipelineStatus.findMany).toHaveBeenCalledTimes(2);
  });

  it('sorts deterministically', async () => {
    answers(own);
    await listForProject(448, 'task');
    // Two statuses of the same rank would come out in a varying order without a tie-break: the "first",
    // serving as a fallback, would change from one call to the next.
    expect((db.pipelineStatus.findMany.mock.calls[0]![0] as { orderBy: unknown }).orderBy).toEqual([
      { scope: 'asc' },
      { order: 'asc' },
      { code: 'asc' },
    ]);
  });
});

describe('resolveByLegacy', () => {
  it("looks for the match in the project's vocabulary, not in the whole reference", async () => {
    answers([], site);
    db.shotgridConnection.findUnique.mockResolvedValue({ active: true });
    const match = await resolveByLegacy(461, 'task', TaskStatus.PENDING_REVIEW);
    expect(match?.code).toBe('suprev');
  });

  it('returns the first status of the project carrying this value', async () => {
    // "wtg" and "hld" both fall back on TODO: it is the project's order that decides, and not the global
    // order of the reference.
    answers([], site);
    db.shotgridConnection.findUnique.mockResolvedValue({ active: true });
    const match = await resolveByLegacy(461, 'task', TaskStatus.TODO);
    expect(match?.code).toBe('wtg');
  });

  it('returns null when no status of the project carries this value', async () => {
    answers([], local);
    db.shotgridConnection.findUnique.mockResolvedValue(null);
    expect(await resolveByLegacy(448, 'task', TaskStatus.RETAKE)).toBeNull();
  });
});

describe('assertBelongsToProject', () => {
  it('accepts a status offered to the project', async () => {
    answers(own);
    await expect(assertBelongsToProject(461, 'task', 20)).resolves.toBe(20);
  });

  it("refuses a status coming from another project's site", async () => {
    // The case that matters: an identifier valid in the database, but foreign to this project.
    answers([], local);
    db.shotgridConnection.findUnique.mockResolvedValue(null);
    await expect(assertBelongsToProject(448, 'task', 12)).rejects.toThrow();
  });

  it('always lets the status be cleared', async () => {
    await expect(assertBelongsToProject(448, 'shot', null)).resolves.toBeNull();
    expect(db.pipelineStatus.findMany).not.toHaveBeenCalled();
  });
});

/**
 * The studio's sort (ShotGrid setting of the project): a site offers twenty-one shot statuses, a production
 * uses only six. What is hidden must no longer be offered — but nothing
 * must ever return an empty list, where no choice would be possible any more and from which one could no
 * longer go back.
 */
describe('listForProject: statuses retained by the project', () => {
  const connectionWith = (visibleStatuses: unknown) =>
    db.shotgridConnection.findUnique.mockResolvedValue({ active: true, settings: { visibleStatuses } });

  it('keeps only the codes ticked for the scope', async () => {
    answers([], site);
    connectionWith({ task: ['wtg', 'suprev'] });
    const r = await listForProject(461, 'task');
    expect(r.map((s) => s.code)).toEqual(['wtg', 'suprev']);
  });

  it('leaves the whole scope when nothing is ticked', async () => {
    answers([], site);
    connectionWith({ task: [], shot: ['fin'] });
    const r = await listForProject(461, 'task');
    expect(r.map((s) => s.code)).toEqual(['wtg', 'hld', 'suprev']);
  });

  it('ignores a filter that no longer recognises any code', async () => {
    // Codes renamed on the site side, a list copied from another project: an empty menu cannot be repaired
    // from the screen where it is missing.
    answers([], site);
    connectionWith({ task: ['inconnu'] });
    const r = await listForProject(461, 'task');
    expect(r.map((s) => s.code)).toEqual(['wtg', 'hld', 'suprev']);
  });

  it('judges the fallback scope by scope', async () => {
    // Without a scope: the task statuses remaining in the result must not make it seem that the shot filter
    // worked.
    const mixed = [...site, { id: 30, scope: 'shot', code: 'fin', origin: 'shotgrid' }];
    answers([], mixed);
    connectionWith({ task: ['wtg'], shot: ['inconnu'] });
    const r = await listForProject(461);
    expect(r.map((s) => s.code)).toEqual(['wtg', 'fin']);
  });

  it('returns the entire catalogue when the settings screen asks for it', async () => {
    answers([], site);
    connectionWith({ task: ['wtg'] });
    const r = await listForProject(461, 'task', { all: true });
    expect(r.map((s) => s.code)).toEqual(['wtg', 'hld', 'suprev']);
  });

  it('filters nothing on an unlinked project', async () => {
    answers([], local);
    db.shotgridConnection.findUnique.mockResolvedValue({ active: false, settings: { task: ['todo'] } });
    const r = await listForProject(448, 'task');
    expect(r.map((s) => s.code)).toEqual(['todo', 'approved']);
  });
});
