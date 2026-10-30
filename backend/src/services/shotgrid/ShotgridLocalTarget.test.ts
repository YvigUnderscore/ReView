// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { links } = vi.hoisted(() => ({ links: { findByLocal: vi.fn() } }));

vi.mock('../../lib/prisma', () => ({ prisma: {} }));
vi.mock('../../lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('./shotgridLinks', () => ({
  findByLocal: (...a: unknown[]) => links.findByLocal(...a),
  findBySg: vi.fn(),
  mapSgToLocal: vi.fn(),
  upsertLink: vi.fn(),
}));

import { localTarget } from './ShotgridPullService';

interface Row {
  id: number;
  name: string;
}

/** An in-memory database: it is the rules that are tested here, not Prisma. */
function table(rows: Row[]) {
  return {
    findById: async (id: number) => rows.find((r) => r.id === id) ?? null,
    findByName: async (name: string) => rows.find((r) => r.name === name) ?? null,
  };
}

const call = (rows: Row[], sgId: number, sgName: string, linkedId: number | null) =>
  localTarget<Row>({
    connectionId: 1,
    localType: 'sequence',
    sgId,
    sgName,
    linkedId,
    ...table(rows),
  });

beforeEach(() => {
  vi.clearAllMocks();
  links.findByLocal.mockResolvedValue(null);
});

describe('localTarget', () => {
  it('creates under the site name when nobody carries it', async () => {
    const r = await call([], 4685, 'sq010', null);
    expect(r).toEqual({ existing: null, name: 'sq010' });
  });

  it('adopts an entity created before the link', async () => {
    // A studio entered its sequences by hand, then linked the project: we take the existing ones
    // rather than making a duplicate.
    const rows = [{ id: 7, name: 'sq010' }];
    const r = await call(rows, 4685, 'sq010', null);
    expect(r.existing?.id).toBe(7);
    expect(r.name).toBe('sq010');
  });

  it('does not adopt an entity already counterpart of another one on the site', async () => {
    links.findByLocal.mockResolvedValue({ sgId: 4685 });
    const rows = [{ id: 7, name: 'DO_NOT_USE_' }];

    const r = await call(rows, 4686, 'DO_NOT_USE_', null);

    expect(r.existing).toBeNull();
    expect(r.name).toBe('DO_NOT_USE_ (4686)');
  });

  it('finds the disambiguated one instead of creating a second', async () => {
    links.findByLocal.mockImplementation(async (_c: number, _t: string, id: number) =>
      id === 7 ? { sgId: 4685 } : null,
    );
    const rows = [
      { id: 7, name: 'DO_NOT_USE_' },
      { id: 8, name: 'DO_NOT_USE_ (4686)' },
    ];

    const r = await call(rows, 4686, 'DO_NOT_USE_', null);

    expect(r.existing?.id).toBe(8);
    expect(r.name).toBe('DO_NOT_USE_ (4686)');
  });

  it('keeps its suffix on the next pass, once linked', async () => {
    // The case that broke in production: the entity is linked, hence found by its id, and we renamed it to the site's name,
    // which its twin still carries.
    const rows = [
      { id: 7, name: 'DO_NOT_USE_' },
      { id: 8, name: 'DO_NOT_USE_ (4686)' },
    ];

    const r = await call(rows, 4686, 'DO_NOT_USE_', 8);

    expect(r.existing?.id).toBe(8);
    expect(r.name).toBe('DO_NOT_USE_ (4686)');
  });

  it('lets the first one keep the site name', async () => {
    const rows = [
      { id: 7, name: 'DO_NOT_USE_' },
      { id: 8, name: 'DO_NOT_USE_ (4686)' },
    ];

    const r = await call(rows, 4685, 'DO_NOT_USE_', 7);

    expect(r.existing?.id).toBe(7);
    expect(r.name).toBe('DO_NOT_USE_');
  });

  it('returns a renamed entity to its site name when it becomes free', async () => {
    // The twin was deleted on the site side: nothing justifies the suffix any more.
    const rows = [{ id: 8, name: 'DO_NOT_USE_ (4686)' }];

    const r = await call(rows, 4686, 'DO_NOT_USE_', 8);

    expect(r.existing?.id).toBe(8);
    expect(r.name).toBe('DO_NOT_USE_');
  });
});
