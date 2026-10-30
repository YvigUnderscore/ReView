// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { db } = vi.hoisted(() => ({
  db: {
    pipelineStatus: { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn(), create: vi.fn() },
    reviewStatus: { findMany: vi.fn(), findUnique: vi.fn() },
  },
}));

vi.mock('../../lib/prisma', () => ({ prisma: db }));
vi.mock('../../lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import type { ShotgridClient } from './ShotgridClient';
import type { SyncJournal } from './ShotgridSyncJournal';
import {
  fetchSiteStatuses,
  fetchValidStatusCodes,
  inverseVersionStatusMap,
  loadPipelineStatuses,
  resolveVersionStatusCode,
  syncPipelineStatuses,
  syncVersionStatuses,
  type SgStatusInfo,
} from './ShotgridStatusSync';

/** ShotGrid client double: the Status records and the `sg_status_list` schema of each entity. */
function client(opts: { statuses?: Record<string, unknown>[]; valid?: Record<string, unknown> | null } = {}) {
  return {
    search: vi.fn().mockResolvedValue(opts.statuses ?? []),
    schemaField: vi.fn().mockResolvedValue(opts.valid === undefined ? null : opts.valid),
  } as unknown as ShotgridClient & {
    search: ReturnType<typeof vi.fn>;
    schemaField: ReturnType<typeof vi.fn>;
  };
}

const schema = (codes: unknown[]) => ({ properties: { valid_values: { value: codes } } });

function journal() {
  return { log: vi.fn().mockResolvedValue(undefined), count: vi.fn() } as unknown as SyncJournal & {
    log: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
  };
}

beforeEach(() => vi.clearAllMocks());

describe('fetchSiteStatuses', () => {
  it('indexes the site statuses by code, with name, colour and order fallbacks', async () => {
    const c = client({
      statuses: [
        { code: 'ip', name: 'In Progress', bg_color: '255,0,0', list_order: 3 },
        { code: 'wtg', bg_color: null },
        { name: 'no code' },
      ],
    });
    const map = await fetchSiteStatuses(c);
    expect([...map.keys()]).toEqual(['ip', 'wtg']);
    expect(map.get('ip')).toEqual({ code: 'ip', name: 'In Progress', color: '#FF0000', order: 3 });
    expect(map.get('wtg')).toEqual({ code: 'wtg', name: 'wtg', color: '#6B7280', order: 0 });
  });
});

describe('fetchValidStatusCodes', () => {
  it('reads the valid values of the status field, strings only', async () => {
    expect(await fetchValidStatusCodes(client({ valid: schema(['wtg', 3, 'ip']) }), 'Shot')).toEqual([
      'wtg',
      'ip',
    ]);
  });

  it('is empty without a schema or without a list', async () => {
    expect(await fetchValidStatusCodes(client({ valid: null }), 'Shot')).toEqual([]);
    expect(await fetchValidStatusCodes(client({ valid: { properties: {} } }), 'Shot')).toEqual([]);
  });
});

describe('syncPipelineStatuses', () => {
  const site = new Map<string, SgStatusInfo>([
    ['ip', { code: 'ip', name: 'In Progress', color: '#FF0000', order: 2 }],
  ]);

  it('creates the missing statuses and updates the existing ones, per entity schema', async () => {
    const c = client({ valid: schema(['wtg', 'ip']) });
    db.pipelineStatus.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 9 });
    db.pipelineStatus.create.mockImplementation(async ({ data }) => ({ id: 1, ...data }));
    db.pipelineStatus.update.mockImplementation(async ({ data }) => ({ id: 9, code: 'ip', ...data }));
    db.pipelineStatus.findMany.mockResolvedValue([]);
    const j = journal();

    const out = await syncPipelineStatuses(c, 'shot', site, j);

    expect(c.schemaField).toHaveBeenCalledWith('Shot', 'sg_status_list');
    expect(db.pipelineStatus.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectId: null,
        scope: 'shot',
        code: 'wtg',
        name: 'WTG',
        origin: 'shotgrid',
        isDefault: true,
      }),
    });
    expect(db.pipelineStatus.update).toHaveBeenCalledWith({
      where: { id: 9 },
      data: expect.objectContaining({ name: 'In Progress', color: '#FF0000', order: 2 }),
    });
    expect([...out.keys()]).toEqual(['wtg', 'ip']);
    expect(j.count).toHaveBeenCalledWith('statuses.shot', 'created');
    expect(j.count).toHaveBeenCalledWith('statuses.shot', 'updated');
  });

  it('only the first shot status is the default, never on another scope', async () => {
    db.pipelineStatus.findFirst.mockResolvedValue(null);
    db.pipelineStatus.create.mockImplementation(async ({ data }) => data);
    db.pipelineStatus.findMany.mockResolvedValue([]);
    await syncPipelineStatuses(client({ valid: schema(['wtg']) }), 'task', site);
    expect(db.pipelineStatus.create.mock.calls[0]![0].data.isDefault).toBe(false);
  });

  it('keeps imported statuses gone from the site, flagged in the journal', async () => {
    db.pipelineStatus.findFirst.mockResolvedValue(null);
    db.pipelineStatus.create.mockImplementation(async ({ data }) => data);
    db.pipelineStatus.findMany.mockResolvedValue([{ id: 4, code: 'old' }]);
    const j = journal();
    const out = await syncPipelineStatuses(client({ valid: schema(['ip']) }), 'sequence', site, j);
    expect(db.pipelineStatus.findMany).toHaveBeenCalledWith({
      where: { projectId: null, scope: 'sequence', origin: 'shotgrid', code: { notIn: ['ip'] } },
    });
    expect(out.get('old')).toEqual({ id: 4, code: 'old' });
    expect(j.log).toHaveBeenCalledWith('info', 'shotgrid.log.statusNotOnSite', {
      code: 'old',
      scope: 'sequence',
    });
  });

  it('without a schema, falls back to the imported statuses only (never the local ones)', async () => {
    db.pipelineStatus.findMany.mockResolvedValue([{ id: 2, code: 'wtg' }]);
    const j = journal();
    const out = await syncPipelineStatuses(client({ valid: null }), 'asset', site, j);
    expect(db.pipelineStatus.findMany).toHaveBeenCalledWith({
      where: { projectId: null, scope: 'asset', origin: 'shotgrid' },
    });
    expect(out.get('wtg')).toEqual({ id: 2, code: 'wtg' });
    expect(j.log).toHaveBeenCalledWith('warn', 'shotgrid.log.noStatusSchema', { entity: 'Asset' });
    expect(db.pipelineStatus.create).not.toHaveBeenCalled();
  });
});

describe('syncVersionStatuses', () => {
  const site = new Map<string, SgStatusInfo>([
    ['apr', { code: 'apr', name: 'Approved', color: '#00FF00', order: 1 }],
    ['rev', { code: 'rev', name: 'Pending Review', color: '#FFFF00', order: 2 }],
  ]);

  it('keeps manual matches, deduces by name, and never creates a review status', async () => {
    db.reviewStatus.findMany.mockResolvedValue([
      { id: 1, name: 'approved' },
      { id: 7, name: 'Retake' },
    ]);
    const j = journal();
    const map = await syncVersionStatuses(
      client({ valid: schema(['apr', 'rtk', 'rev', 'stale']) }),
      site,
      { rtk: 7, stale: 99 },
      j,
    );
    expect(map).toEqual({ apr: 1, rtk: 7 });
    expect(j.count).toHaveBeenCalledWith('statuses.version', 'skipped');
    expect(j.log).toHaveBeenCalledWith('warn', 'shotgrid.log.reviewStatusUnmapped', {
      code: 'rev',
      name: 'Pending Review',
    });
    expect(j.log).toHaveBeenCalledWith('warn', 'shotgrid.log.reviewStatusUnmapped', {
      code: 'stale',
      name: 'STALE',
    });
  });

  it('without a schema, returns the existing map untouched', async () => {
    const j = journal();
    const existing = { apr: 1 };
    expect(await syncVersionStatuses(client({ valid: null }), site, existing, j)).toBe(existing);
    expect(db.reviewStatus.findMany).not.toHaveBeenCalled();
  });
});

describe('inverseVersionStatusMap', () => {
  it('maps each review status to its first ShotGrid code', () => {
    expect([...inverseVersionStatusMap({ apr: 1, fin: 1, rtk: 2 })]).toEqual([
      [1, 'apr'],
      [2, 'rtk'],
    ]);
  });
});

describe('resolveVersionStatusCode', () => {
  it('finds the code by name, read-only', async () => {
    db.reviewStatus.findUnique.mockResolvedValue({ id: 1, name: 'Approved' });
    const c = client({ valid: schema(['rev', 'apr']), statuses: [{ code: 'apr', name: 'APPROVED' }] });
    expect(await resolveVersionStatusCode(c, 1)).toBe('apr');
  });

  it('falls back on the upper-cased code as the name', async () => {
    db.reviewStatus.findUnique.mockResolvedValue({ id: 1, name: 'rtk' });
    expect(await resolveVersionStatusCode(client({ valid: schema(['rtk']) }), 1)).toBe('rtk');
  });

  it('is null for an unknown status, a missing schema or no match', async () => {
    db.reviewStatus.findUnique.mockResolvedValueOnce(null);
    expect(await resolveVersionStatusCode(client({ valid: schema(['apr']) }), 1)).toBeNull();
    db.reviewStatus.findUnique.mockResolvedValue({ id: 1, name: 'Approved' });
    expect(await resolveVersionStatusCode(client({ valid: null }), 1)).toBeNull();
    expect(await resolveVersionStatusCode(client({ valid: schema(['ip']) }), 1)).toBeNull();
  });
});

describe('loadPipelineStatuses', () => {
  it('indexes a scope by code', async () => {
    db.pipelineStatus.findMany.mockResolvedValue([{ code: 'ip' }, { code: 'wtg' }]);
    const map = await loadPipelineStatuses('task');
    expect(db.pipelineStatus.findMany).toHaveBeenCalledWith({ where: { scope: 'task' } });
    expect([...map.keys()]).toEqual(['ip', 'wtg']);
  });
});
