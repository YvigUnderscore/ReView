// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { slugify, entitySlug, mediaSlug, parseIdParam, projectPath, reviewPath, episodePath } from './slug';

describe('slugify', () => {
  it('removes accents, punctuation and casing', () => {
    expect(slugify('Le Projet Démo !')).toBe('le-projet-demo');
    expect(slugify('  Éléphant/Château  ')).toBe('elephant-chateau');
  });
  it('returns an empty string for a name with no alphanumeric character', () => {
    expect(slugify('!!! ---')).toBe('');
    expect(slugify(null)).toBe('');
  });
});

describe('entitySlug', () => {
  it('assemble slug-{id}', () => {
    expect(entitySlug('Le Projet Démo', 390)).toBe('le-projet-demo-390');
  });
  it('falls back to the pure id when the name produces no slug', () => {
    expect(entitySlug('###', 390)).toBe('390');
    expect(entitySlug('', 7)).toBe('7');
  });
});

describe('mediaSlug', () => {
  it("removes the file extension", () => {
    expect(mediaSlug('perso_principal_v01.mp4', 219)).toBe('perso-principal-v01-219');
    expect(mediaSlug('scene.final.glb', 5)).toBe('scene-final-5');
  });
});

describe('parseIdParam', () => {
  it('extracts the last group of digits', () => {
    expect(parseIdParam('le-projet-demo-390')).toBe(390);
    expect(parseIdParam('perso-principal-v01-219')).toBe(219);
    expect(parseIdParam('shot-001-42')).toBe(42);
  });
  it('tolerates the pure id (backward compatibility with old links)', () => {
    expect(parseIdParam('219')).toBe(219);
  });
  it('returns NaN without digits', () => {
    expect(parseIdParam('')).toBeNaN();
    expect(parseIdParam(undefined)).toBeNaN();
    expect(parseIdParam('abc')).toBeNaN();
  });
});

describe('helpers de chemin', () => {
  it('projectPath with and without suffix', () => {
    expect(projectPath({ id: 390, name: 'Le Projet Démo' })).toBe('/projects/le-projet-demo-390');
    expect(projectPath({ id: 390, name: 'Le Projet Démo' }, '/kanban')).toBe(
      '/projects/le-projet-demo-390/kanban',
    );
  });
  it('reviewPath from the file name', () => {
    expect(reviewPath({ id: 219, originalName: 'perso_principal_v01.mp4' })).toBe(
      '/review/perso-principal-v01-219',
    );
  });
  it('episodePath from the code, and tolerates a missing code', () => {
    expect(episodePath({ id: 4, code: 'EP101' })).toBe('/episodes/ep101-4');
    expect(episodePath({ id: 4, code: null })).toBe('/episodes/4');
  });
  it('round-trip: parseIdParam recovers the id of the generated paths', () => {
    const p = projectPath({ id: 390, name: 'Château 2024' });
    expect(parseIdParam(p.split('/').pop())).toBe(390);
    const r = reviewPath({ id: 219, originalName: '2024-final.mp4' });
    expect(parseIdParam(r.split('/').pop())).toBe(219);
  });
});
