// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { filterProjects, quotaPct, pipelineLabel } from './adminProjects';
import type { AdminProjectRow } from '../../types/api';

const row = (over: Partial<AdminProjectRow>): AdminProjectRow => ({
  id: 1,
  name: 'Demo',
  slug: 'demo',
  status: 'ACTIVE',
  createdAt: '2026-01-01T00:00:00Z',
  usage: 0,
  quota: null,
  counts: { memberships: 0, sequences: 0, shots: 0, assets: 0, versions: 0, media: 0 },
  ...over,
});

describe('adminProjects — filterProjects', () => {
  const all = [
    row({ id: 1, name: 'Film Alpha', slug: 'film-alpha' }),
    row({ id: 2, name: 'Pub Beta', slug: 'pub-beta', status: 'ARCHIVED' }),
  ];
  it('filtre par statut et par texte sur nom/slug', () => {
    expect(filterProjects(all, '', 'ALL')).toHaveLength(2);
    expect(filterProjects(all, '', 'ARCHIVED').map((p) => p.id)).toEqual([2]);
    expect(filterProjects(all, 'ALPHA', 'ALL').map((p) => p.id)).toEqual([1]);
    expect(filterProjects(all, 'pub-', 'ALL').map((p) => p.id)).toEqual([2]);
    expect(filterProjects(all, 'alpha', 'ARCHIVED')).toEqual([]);
  });
});

describe('adminProjects — quotaPct', () => {
  it('calcule le pourcentage borné, null sans quota', () => {
    expect(quotaPct(50, 100)).toBe(50);
    expect(quotaPct(200, 100)).toBe(100);
    expect(quotaPct(0, 100)).toBe(0);
    expect(quotaPct(50, null)).toBeNull();
    expect(quotaPct(50, 0)).toBeNull();
  });
});

describe('adminProjects — pipelineLabel', () => {
  it('formate résolution et framerate', () => {
    expect(pipelineLabel({ resolution: { width: 1920, height: 1080 }, framerate: 24 })).toBe(
      '1920×1080 · 24 fps',
    );
  });
});
