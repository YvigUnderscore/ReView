// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { resolveDisplayView } from './colorSettings';

const displays = [
  { name: 'sRGB - Display', views: ['ACES 1.0 - SDR Video', 'Raw'] },
  { name: 'Rec.1886 Rec.709 - Display', views: ['ACES 1.0 - SDR Video'] },
];

const project = { configId: 'cfg', display: 'sRGB - Display', view: 'ACES 1.0 - SDR Video' };

/**
 * Ce fichier éprouvait aussi les bornes, la neutralité et la persistance des réglages de
 * review (exposition, gamma, display/view choisis au dock). Ces réglages n'existent plus —
 * le panneau Color est retiré en Phase 50 et la gestion couleur est celle du projet. Les tests
 * qui les verrouillaient sont donc réécrits sciemment sur ce qui reste : résoudre le couple
 * display/view **du projet** contre la config réellement chargée.
 */
describe('colorSettings — couple display/view du projet', () => {
  it('sans config de projet, il n’y a rien à appliquer', () => {
    expect(resolveDisplayView(null, displays)).toBeNull();
    expect(resolveDisplayView({ display: 'x', view: 'y' }, displays)).toBeNull();
  });

  it('un projet sans couple complet n’applique rien', () => {
    expect(resolveDisplayView({ configId: 'cfg', display: 'sRGB - Display' }, displays)).toBeNull();
    expect(resolveDisplayView({ configId: 'cfg', view: 'Raw' }, displays)).toBeNull();
  });

  it('rend le couple du projet', () => {
    expect(resolveDisplayView(project, displays)).toEqual({
      configId: 'cfg',
      display: 'sRGB - Display',
      view: 'ACES 1.0 - SDR Video',
    });
  });

  it('un couple projet absent de la config chargée ne vaut plus rien', () => {
    const stale = { configId: 'cfg', display: 'Gone - Display', view: 'Raw' };
    expect(resolveDisplayView(stale, displays)).toBeNull();
    // Une view disparue de la config compte autant qu'un display disparu.
    expect(resolveDisplayView({ ...project, view: 'Gone - View' }, displays)).toBeNull();
    // Tant que la liste n'est pas chargée, on fait confiance au projet.
    expect(resolveDisplayView(stale, [])).toMatchObject({ display: 'Gone - Display' });
  });
});
