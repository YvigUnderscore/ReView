// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi } from 'vitest';

// Pure functions under test: env/DB dependencies of the imports are stubbed out.
vi.mock('../lib/prisma', () => ({ prisma: {} }));
vi.mock('../lib/storage', () => ({ storage: {} }));

import { versionWhere, commentWhere, versionLocation, projectPathsOf } from './AdminContentService';

describe('AdminContentService — versionWhere', () => {
  it('always excludes deleted versions', () => {
    expect(versionWhere({})).toEqual({ deletedAt: null });
  });

  it('combines status, publication, media type and search', () => {
    const where = versionWhere({ status: 'REVIEW', published: true, kind: 'VIDEO', q: 'V0' });
    expect(where.status).toBe('REVIEW');
    expect(where.published).toBe(true);
    expect(where.media).toEqual({ some: { kind: 'VIDEO', deletedAt: null } });
    expect(where.name).toEqual({ contains: 'V0', mode: 'insensitive' });
  });

  it('filters by project through the three possible paths', () => {
    const where = versionWhere({ projectId: 7 });
    expect(where.OR).toEqual(projectPathsOf(7));
    expect(projectPathsOf(7)).toHaveLength(3);
  });

  it('published: false filters correctly (distinct from "not set")', () => {
    expect(versionWhere({ published: false }).published).toBe(false);
    expect(versionWhere({}).published).toBeUndefined();
  });
});

describe('AdminContentService — versionLocation', () => {
  it('shot with sequence -> "SQ · SH › task"', () => {
    expect(
      versionLocation({
        task: { name: 'anim', shot: { code: 'SH020', sequence: { code: 'SQ010' } } },
      }),
    ).toBe('SQ010 · SH020 › anim');
  });

  it('shot without sequence -> "SH › task"', () => {
    expect(versionLocation({ task: { name: 'comp', shot: { code: 'SH030', sequence: null } } })).toBe(
      'SH030 › comp',
    );
  });

  it('asset task -> "asset › task"; direct asset version -> asset name', () => {
    expect(versionLocation({ task: { name: 'lookdev', asset: { name: 'perso' } } })).toBe('perso › lookdev');
    expect(versionLocation({ asset: { name: 'décor' } })).toBe('décor');
    expect(versionLocation({})).toBe('');
  });
});

describe('AdminContentService — commentWhere', () => {
  it('empty by default (all comments)', () => {
    expect(commentWhere({})).toEqual({});
  });

  it('combines author, resolution and full-text search', () => {
    const where = commentWhere({ authorId: 3, resolved: false, q: 'retake' });
    expect(where.userId).toBe(3);
    expect(where.isResolved).toBe(false);
    expect(where.content).toEqual({ contains: 'retake', mode: 'insensitive' });
  });

  it('resolves to the project via media -> version', () => {
    expect(commentWhere({ projectId: 9 }).media).toEqual({
      version: { OR: projectPathsOf(9) },
    });
  });
});
