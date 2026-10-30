// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { db, openConnection, mapSgToLocal, search, findById } = vi.hoisted(() => ({
  db: {
    sequence: { findMany: vi.fn() },
    shot: { findMany: vi.fn() },
    asset: { findMany: vi.fn() },
    task: { findMany: vi.fn() },
    version: { findMany: vi.fn() },
  },
  openConnection: vi.fn(),
  mapSgToLocal: vi.fn(),
  search: vi.fn(),
  findById: vi.fn(),
}));

vi.mock('../../lib/prisma', () => ({ prisma: db }));
vi.mock('./ShotgridConfigService', () => ({ openConnection }));
vi.mock('./shotgridLinks', () => ({ mapSgToLocal }));
vi.mock('./shotgridSettings', () => ({
  sgDeepLink: (base: string, type: string, id: number) => `${base}/detail/${type}/${id}`,
}));

import { buildDiff } from './ShotgridDiffService';

const PROJECT = { type: 'Project', id: 50 };
type Remote = { type: string; id: number; project: unknown; [field: string]: unknown };
const sg = (type: string, id: number, fields: Record<string, unknown> = {}): Remote => ({
  type,
  id,
  project: PROJECT,
  ...fields,
});

/** ShotGrid side, per entity; local side, per Prisma model; links, per local type (sgId -> localId). */
function setup(opts: {
  remote?: Record<string, Remote[]>;
  local?: Partial<Record<keyof typeof db, unknown[]>>;
  links?: Record<string, Array<[number, number]>>;
  remoteName?: string | null;
  versionStatusMap?: Record<string, number>;
}) {
  openConnection.mockResolvedValue({
    connection: { id: 3, sgProjectId: 50, sgProjectName: 'Film', site: { baseUrl: 'https://sg' } },
    settings: { versionStatusMap: opts.versionStatusMap ?? {} },
    client: { search, findById },
  });
  findById.mockResolvedValue(opts.remoteName === null ? null : { name: opts.remoteName ?? 'Film' });
  search.mockImplementation(async (entity: string) => opts.remote?.[entity] ?? []);
  mapSgToLocal.mockImplementation(
    async (_connectionId: number, type: string) =>
      new Map((opts.links?.[type] ?? []).map(([sgId, localId]) => [sgId, { sgId, localId }])),
  );
  for (const model of Object.keys(db) as (keyof typeof db)[])
    db[model].findMany.mockResolvedValue(opts.local?.[model] ?? []);
}

beforeEach(() => vi.clearAllMocks());

describe('buildDiff', () => {
  it('an aligned project has no entries and counts both sides', async () => {
    setup({
      remote: { Sequence: [sg('Sequence', 1, { code: 'SQ010', sg_status_list: 'ip' })] },
      local: { sequence: [{ id: 10, code: 'SQ010', pipelineStatus: { code: 'ip' } }] },
      links: { sequence: [[1, 10]] },
    });
    const report = await buildDiff(7);
    expect(openConnection).toHaveBeenCalledWith(7, { verifyProject: false });
    expect(report.entries).toEqual([]);
    expect(report.projectNameOk).toBe(true);
    expect(report.counts.Sequence).toEqual({ review: 1, shotgrid: 1 });
    expect(report.truncated).toBe(false);
  });

  it('flags a renamed remote project (case and spaces ignored)', async () => {
    setup({ remoteName: '  film ' });
    expect((await buildDiff(7)).projectNameOk).toBe(true);
    setup({ remoteName: 'Other' });
    const report = await buildDiff(7);
    expect(report.projectNameOk).toBe(false);
    expect(report.remoteProjectName).toBe('Other');
    setup({ remoteName: null });
    expect((await buildDiff(7)).projectNameOk).toBe(false);
  });

  it('ignores remote records of another project', async () => {
    setup({ remote: { Shot: [{ type: 'Shot', id: 9, code: 'X', project: { type: 'Project', id: 99 } }] } });
    const report = await buildDiff(7);
    expect(report.entries).toEqual([]);
    expect(report.counts.Shot?.shotgrid).toBe(0);
  });

  it('sequences: missing locally, diverging code/status, local never linked', async () => {
    setup({
      remote: {
        Sequence: [
          sg('Sequence', 1, { code: 'SQ010', sg_status_list: 'fin' }),
          sg('Sequence', 2, { code: null }),
        ],
      },
      local: {
        sequence: [
          { id: 10, code: 'SQ010 (1)', pipelineStatus: { code: 'ip' } },
          { id: 11, code: 'SQ099', pipelineStatus: null },
        ],
      },
      links: { sequence: [[1, 10]] },
    });
    const { entries } = await buildDiff(7);
    expect(entries).toEqual([
      {
        kind: 'field_differs',
        entity: 'Sequence',
        name: 'SQ010',
        sgId: 1,
        localId: 10,
        sgUrl: 'https://sg/detail/Sequence/1',
        fields: [{ field: 'status', review: 'ip', shotgrid: 'fin' }],
      },
      {
        kind: 'missing_local',
        entity: 'Sequence',
        name: '#2',
        sgId: 2,
        localId: null,
        sgUrl: 'https://sg/detail/Sequence/2',
      },
      { kind: 'unlinked', entity: 'Sequence', name: 'SQ099', sgId: null, localId: 11, sgUrl: null },
    ]);
  });

  it('shots: frame range gaps, unlinked, removed from ShotGrid', async () => {
    setup({
      remote: {
        Shot: [
          sg('Shot', 1, { code: 'SH010', sg_cut_in: 1001, sg_cut_out: 1050, sg_status_list: 'ip' }),
          sg('Shot', 2, { code: 'SH020' }),
        ],
      },
      local: {
        shot: [
          { id: 10, code: 'SH010', startFrame: 1001, endFrame: 1060, pipelineStatus: { code: 'ip' } },
          { id: 11, code: 'SH030', startFrame: null, endFrame: null, pipelineStatus: null },
          { id: 12, code: 'SH040', startFrame: null, endFrame: null, pipelineStatus: null },
        ],
      },
      links: {
        shot: [
          [1, 10],
          [77, 12],
        ],
      },
    });
    const { entries } = await buildDiff(7);
    expect(entries.map((e) => [e.kind, e.name])).toEqual([
      ['field_differs', 'SH010'],
      ['missing_local', 'SH020'],
      ['unlinked', 'SH030'],
      ['missing_remote', 'SH040'],
    ]);
    expect(entries[0]!.fields).toEqual([{ field: 'endFrame', review: '1060', shotgrid: '1050' }]);
    expect(entries[3]).toMatchObject({ sgId: 77, localId: 12, sgUrl: 'https://sg/detail/Shot/77' });
  });

  it('assets: only the missing ones are reported', async () => {
    setup({
      remote: { Asset: [sg('Asset', 1, { code: 'hero' }), sg('Asset', 2, { code: 'prop' })] },
      local: { asset: [{ id: 10, name: 'hero' }] },
      links: { asset: [[1, 10]] },
    });
    const { entries } = await buildDiff(7);
    expect(entries).toEqual([
      {
        kind: 'missing_local',
        entity: 'Asset',
        name: 'prop',
        sgId: 2,
        localId: null,
        sgUrl: 'https://sg/detail/Asset/2',
      },
    ]);
  });

  it('tasks: name, status and dates compared at day precision', async () => {
    setup({
      remote: {
        Task: [
          sg('Task', 1, {
            content: 'layout',
            sg_status_list: 'ip',
            start_date: '2026-01-05',
            due_date: '2026-01-09',
          }),
          sg('Task', 2, {}),
        ],
      },
      local: {
        task: [
          {
            id: 10,
            name: 'layout',
            pipelineStatus: { code: 'ip' },
            startDate: new Date('2026-01-05T12:00:00Z'),
            dueDate: new Date('2026-01-12T00:00:00Z'),
          },
        ],
      },
      links: { task: [[1, 10]] },
    });
    const { entries } = await buildDiff(7);
    expect(entries[0]!.fields).toEqual([{ field: 'dueDate', review: '2026-01-12', shotgrid: '2026-01-09' }]);
    expect(entries[1]).toMatchObject({ kind: 'missing_local', entity: 'Task', name: '#2' });
  });

  it('versions: the review decision is compared through the status map', async () => {
    setup({
      remote: {
        Version: [
          sg('Version', 1, { code: 'v001', sg_status_list: 'apr' }),
          sg('Version', 2, { code: 'v002', sg_status_list: 'unmapped' }),
          sg('Version', 3, { code: 'v003', sg_status_list: 'apr' }),
          sg('Version', 4, { code: 'v004' }),
        ],
      },
      local: {
        version: [
          { id: 10, reviewStatusId: 2, reviewStatus: { name: 'Retake' } },
          { id: 11, reviewStatusId: null, reviewStatus: null },
          { id: 12, reviewStatusId: 1, reviewStatus: { name: 'Approved' } },
        ],
      },
      links: {
        version: [
          [1, 10],
          [2, 11],
          [3, 12],
        ],
      },
      versionStatusMap: { apr: 1 },
    });
    const { entries } = await buildDiff(7);
    expect(entries).toEqual([
      expect.objectContaining({
        kind: 'field_differs',
        entity: 'Version',
        name: 'v001',
        fields: [{ field: 'reviewStatus', review: 'Retake', shotgrid: 'apr' }],
      }),
      expect.objectContaining({ kind: 'missing_local', entity: 'Version', name: 'v004' }),
    ]);
  });

  it('caps the report at 500 entries and says so', async () => {
    setup({
      remote: { Asset: Array.from({ length: 501 }, (_, i) => sg('Asset', i + 1, { code: `a${i}` })) },
    });
    const report = await buildDiff(7);
    expect(report.entries).toHaveLength(500);
    expect(report.truncated).toBe(true);
  });
});
