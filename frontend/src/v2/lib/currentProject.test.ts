// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { isEntityPage, resolveCurrentProjectId } from './currentProject';

describe('isEntityPage', () => {
  // Les trois familles absentes de la liste d'origine : leur oubli coupait le temps réel
  // et les raccourcis `g k` / `g b` sur les pages les plus fréquentées de la production.
  it.each(['/shots/21', '/sequences/13', '/episodes/4', '/tasks/82', '/assets/58', '/review/20'])(
    'reconnaît %s comme page d’entité',
    (pathname) => {
      expect(isEntityPage(pathname)).toBe(true);
    },
  );

  it.each(['/', '/projects', '/projects/7', '/reviews', '/profile', '/admin/users', '/docs'])(
    'ne prend pas %s pour une page d’entité',
    (pathname) => {
      expect(isEntityPage(pathname)).toBe(false);
    },
  );

  it('exige le séparateur : /shots seul n’est pas une fiche de plan', () => {
    expect(isEntityPage('/shots')).toBe(false);
    expect(isEntityPage('/shotsomething/1')).toBe(false);
  });
});

describe('resolveCurrentProjectId', () => {
  it('préfère toujours le projet porté par l’URL', () => {
    expect(resolveCurrentProjectId('/projects/7', 7, 42)).toBe(7);
  });

  it('retombe sur le contexte du fil d’Ariane sur une page d’entité', () => {
    expect(resolveCurrentProjectId('/shots/21', null, 7)).toBe(7);
    expect(resolveCurrentProjectId('/sequences/13', null, 7)).toBe(7);
    expect(resolveCurrentProjectId('/episodes/4', null, 7)).toBe(7);
  });

  it('rend null hors projet, même si un contexte traîne encore', () => {
    expect(resolveCurrentProjectId('/reviews', null, 7)).toBeNull();
    expect(resolveCurrentProjectId('/', null, 7)).toBeNull();
  });

  it('rend null quand le contexte n’est pas encore résolu', () => {
    expect(resolveCurrentProjectId('/shots/21', null, null)).toBeNull();
  });
});
