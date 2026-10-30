// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { db, log } = vi.hoisted(() => ({
  db: { shotgridLink: { findMany: vi.fn(), delete: vi.fn(), upsert: vi.fn() } },
  log: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../lib/prisma', () => ({ prisma: db }));
vi.mock('../../lib/logger', () => ({ logger: log }));

import { listForUi, shouldImportMedia, upsertLink, UI_LINK_TYPES, UI_LINKS_LIMIT } from './shotgridLinks';
import { AppError } from '../../lib/errors';

const link = (id: number, localType = 'shot') => ({
  localType,
  localId: id,
  sgId: 1000 + id,
  sgType: 'Shot',
  syncedAt: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  db.shotgridLink.findMany.mockResolvedValue([link(1), link(2)]);
});

describe('listForUi', () => {
  it('bounds the correspondence table served to the interface', async () => {
    // The query was not bounded: at 2,000 shots, 10,000 tasks and 20,000 versions, it returned several megabytes of JSON per project opening.
    await listForUi(12);
    expect(db.shotgridLink.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: UI_LINKS_LIMIT }));
  });

  it('sorts by type then local id: the truncation trims the versions first', async () => {
    // `version` is the last type in alphabetical order — the degradation thus touches what is displayed the least, never the shots or the tasks.
    await listForUi(12);
    const args = db.shotgridLink.findMany.mock.calls[0]![0] as { orderBy: unknown };
    expect(args.orderBy).toEqual([{ localType: 'asc' }, { localId: 'asc' }]);
    expect([...UI_LINK_TYPES].sort().at(-1)).toBe('version');
  });

  it('queries by default the five types the interface displays', async () => {
    await listForUi(12);
    const args = db.shotgridLink.findMany.mock.calls[0]![0] as {
      where: { connectionId: number; localType: { in: string[] } };
    };
    expect(args.where.connectionId).toBe(12);
    expect(args.where.localType.in).toEqual([...UI_LINK_TYPES]);
  });

  it('accepts a type filter for a screen that displays only one', async () => {
    await listForUi(12, { localTypes: ['shot'] });
    const args = db.shotgridLink.findMany.mock.calls[0]![0] as {
      where: { localType: { in: string[] } };
    };
    expect(args.where.localType.in).toEqual(['shot']);
  });

  it('does not let a caller exceed the cap', async () => {
    await listForUi(12, { limit: 10 ** 9 });
    expect(db.shotgridLink.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: UI_LINKS_LIMIT }));
  });

  it('logs the truncation: a missing badge reads as "not linked"', async () => {
    db.shotgridLink.findMany.mockResolvedValue([link(1), link(2)]);
    await listForUi(12, { limit: 2 });
    expect(log.warn).toHaveBeenCalledWith({ connectionId: 12, limit: 2 }, 'shotgrid links truncated for UI');
  });

  it('stays silent when nothing was cut', async () => {
    await listForUi(12);
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('returns the columns the interface consumes, and not the link data', async () => {
    await listForUi(12);
    const args = db.shotgridLink.findMany.mock.calls[0]![0] as { select: Record<string, boolean> };
    expect(args.select).toEqual({
      localType: true,
      localId: true,
      sgId: true,
      sgType: true,
      syncedAt: true,
    });
  });
});

describe('upsertLink: conflicts', () => {
  const params = {
    connectionId: 12,
    localType: 'media' as const,
    localId: 4,
    sgType: 'Attachment',
    sgId: 412,
  };

  beforeEach(() => {
    db.shotgridLink.upsert.mockResolvedValue({ id: 1 });
  });

  it('refuses to overwrite the link of a DIFFERENT local type', async () => {
    // The lying-link scenario: `('Attachment', 412)` designating in fact Version 412 came and erased the correspondence of the real Attachment 412. A ShotGrid
    // identifier designates only one local type — replacing was corruption, not rewiring.
    db.shotgridLink.findMany.mockResolvedValue([
      { id: 9, localType: 'comment', localId: 77, sgType: 'Attachment', sgId: 412 },
    ]);
    await expect(upsertLink(params)).rejects.toBeInstanceOf(AppError);
    expect(db.shotgridLink.delete).not.toHaveBeenCalled();
    expect(db.shotgridLink.upsert).not.toHaveBeenCalled();
  });

  it('accepts a rewiring of the same type but logs it', async () => {
    // Legitimate case: the remote entity has been recreated on the site with a new identifier. The previous link goes — the abandoned entity becomes "never
    // imported" and will be recreated at the client: it is traced.
    db.shotgridLink.findMany.mockResolvedValue([
      { id: 9, localType: 'media', localId: 4, sgType: 'Attachment', sgId: 99 },
    ]);
    await upsertLink(params);
    expect(db.shotgridLink.delete).toHaveBeenCalledWith({ where: { id: 9 } });
    expect(log.warn).toHaveBeenCalledWith(expect.anything(), 'shotgrid link rebound');
    expect(db.shotgridLink.upsert).toHaveBeenCalled();
  });

  it('removes ALL conflicts, not only the first', async () => {
    // A link can clash with both uniques at once, on two distinct rows: removing only one would leave the upsert stumbling on the other constraint.
    db.shotgridLink.findMany.mockResolvedValue([
      { id: 9, localType: 'media', localId: 4, sgType: 'Attachment', sgId: 99 },
      { id: 10, localType: 'media', localId: 5, sgType: 'Attachment', sgId: 412 },
    ]);
    await upsertLink(params);
    expect(db.shotgridLink.delete).toHaveBeenCalledTimes(2);
  });

  it('writes and deletes nothing more when the way is clear', async () => {
    db.shotgridLink.findMany.mockResolvedValue([]);
    await upsertLink(params);
    expect(db.shotgridLink.delete).not.toHaveBeenCalled();
    expect(log.warn).not.toHaveBeenCalled();
    expect(db.shotgridLink.upsert).toHaveBeenCalledTimes(1);
  });
});

describe('shouldImportMedia (unchanged guard)', () => {
  it('does not re-import a media born in ReView', () => {
    expect(shouldImportMedia({ withMedia: true, autoImport: true, link: { createdFromReview: true } })).toBe(
      false,
    );
    expect(shouldImportMedia({ withMedia: true, autoImport: true, link: {} })).toBe(true);
  });
});
