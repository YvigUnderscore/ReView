// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { slugify, entitySlug, mediaSlug, parseIdParam, projectPath, reviewPath } from './slug';

describe('slugify', () => {
  it('retire accents, ponctuation et casse', () => {
    expect(slugify('Le Projet Démo !')).toBe('le-projet-demo');
    expect(slugify('  Éléphant/Château  ')).toBe('elephant-chateau');
  });
  it('renvoie une chaîne vide pour un nom sans caractère alphanumérique', () => {
    expect(slugify('!!! ---')).toBe('');
    expect(slugify(null)).toBe('');
  });
});

describe('entitySlug', () => {
  it('assemble slug-{id}', () => {
    expect(entitySlug('Le Projet Démo', 390)).toBe('le-projet-demo-390');
  });
  it('se replie sur le pur-id quand le nom ne produit pas de slug', () => {
    expect(entitySlug('###', 390)).toBe('390');
    expect(entitySlug('', 7)).toBe('7');
  });
});

describe('mediaSlug', () => {
  it("retire l'extension de fichier", () => {
    expect(mediaSlug('perso_principal_v01.mp4', 219)).toBe('perso-principal-v01-219');
    expect(mediaSlug('scene.final.glb', 5)).toBe('scene-final-5');
  });
});

describe('parseIdParam', () => {
  it('extrait le dernier groupe de chiffres', () => {
    expect(parseIdParam('le-projet-demo-390')).toBe(390);
    expect(parseIdParam('perso-principal-v01-219')).toBe(219);
    expect(parseIdParam('shot-001-42')).toBe(42);
  });
  it('tolère le pur-id (rétrocompat des anciens liens)', () => {
    expect(parseIdParam('219')).toBe(219);
  });
  it('renvoie NaN sans chiffre', () => {
    expect(parseIdParam('')).toBeNaN();
    expect(parseIdParam(undefined)).toBeNaN();
    expect(parseIdParam('abc')).toBeNaN();
  });
});

describe('helpers de chemin', () => {
  it('projectPath avec et sans suffixe', () => {
    expect(projectPath({ id: 390, name: 'Le Projet Démo' })).toBe('/projects/le-projet-demo-390');
    expect(projectPath({ id: 390, name: 'Le Projet Démo' }, '/kanban')).toBe(
      '/projects/le-projet-demo-390/kanban',
    );
  });
  it('reviewPath depuis le nom de fichier', () => {
    expect(reviewPath({ id: 219, originalName: 'perso_principal_v01.mp4' })).toBe(
      '/review/perso-principal-v01-219',
    );
  });
  it('round-trip : parseIdParam retrouve l’id des chemins générés', () => {
    const p = projectPath({ id: 390, name: 'Château 2024' });
    expect(parseIdParam(p.split('/').pop())).toBe(390);
    const r = reviewPath({ id: 219, originalName: '2024-final.mp4' });
    expect(parseIdParam(r.split('/').pop())).toBe(219);
  });
});
