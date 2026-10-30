// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { normalizeFilters, filtersEqual, upsertView, removeView } from './useSavedViews';
import type { SavedView } from '../types/preferences';

describe('useSavedViews — helpers (42.A5)', () => {
  it('normalizeFilters removes empty values', () => {
    expect(normalizeFilters({ a: '1', b: '', c: 'x' })).toEqual({ a: '1', c: 'x' });
  });

  it('filtersEqual ignores empty keys', () => {
    expect(filtersEqual({ a: '1', b: '' }, { a: '1' })).toBe(true);
    expect(filtersEqual({ a: '1' }, { a: '2' })).toBe(false);
    expect(filtersEqual({ a: '1' }, { a: '1', c: 'x' })).toBe(false);
  });

  it('upsertView adds a view and normalises its filters', () => {
    const next = upsertView([], 'Retards', { status: 'draft', kind: '' });
    expect(next).toHaveLength(1);
    expect(next[0].name).toBe('Retards');
    expect(next[0].filters).toEqual({ status: 'draft' });
    expect(next[0].id).toMatch(/^v/);
  });

  it('upsertView replaces by name (case/whitespace-insensitive) keeping the id', () => {
    const existing: SavedView[] = [{ id: 'v1', name: 'Retards', filters: { status: 'draft' } }];
    const next = upsertView(existing, '  retards ', { status: 'published' });
    expect(next).toHaveLength(1);
    expect(next[0].id).toBe('v1');
    expect(next[0].filters).toEqual({ status: 'published' });
  });

  it('removeView deletes by id', () => {
    const views: SavedView[] = [
      { id: 'v1', name: 'A', filters: {} },
      { id: 'v2', name: 'B', filters: {} },
    ];
    expect(removeView(views, 'v1')).toEqual([{ id: 'v2', name: 'B', filters: {} }]);
  });
});
