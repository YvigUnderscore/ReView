// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { isEntityPage, resolveCurrentProjectId } from './currentProject';

describe('isEntityPage', () => {
  // The three families missing from the original list: forgetting them cut real-time updates
  // and the `g k` / `g b` shortcuts on the most visited production pages.
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

  it('requires the separator: /shots alone is not a plan page', () => {
    expect(isEntityPage('/shots')).toBe(false);
    expect(isEntityPage('/shotsomething/1')).toBe(false);
  });
});

describe('resolveCurrentProjectId', () => {
  it('always prefers the project carried by the URL', () => {
    expect(resolveCurrentProjectId('/projects/7', 7, 42)).toBe(7);
  });

  it('falls back to the breadcrumb context on an entity page', () => {
    expect(resolveCurrentProjectId('/shots/21', null, 7)).toBe(7);
    expect(resolveCurrentProjectId('/sequences/13', null, 7)).toBe(7);
    expect(resolveCurrentProjectId('/episodes/4', null, 7)).toBe(7);
  });

  it('returns null outside a project, even if a context is still lingering', () => {
    expect(resolveCurrentProjectId('/reviews', null, 7)).toBeNull();
    expect(resolveCurrentProjectId('/', null, 7)).toBeNull();
  });

  it('returns null when the context is not yet resolved', () => {
    expect(resolveCurrentProjectId('/shots/21', null, null)).toBeNull();
  });
});
