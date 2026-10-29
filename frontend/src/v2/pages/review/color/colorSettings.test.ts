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
 * This file used to also test the bounds, the neutrality and the persistence of the review
 * settings (exposure, gamma, display/view chosen in the dock). Those settings no longer exist —
 * the Color panel was removed in Phase 50 and color management is the project's. The tests that
 * locked them are therefore deliberately rewritten around what remains: resolving the **project's**
 * display/view pair against the config actually loaded.
 */
describe('colorSettings — project display/view pair', () => {
  it('without a project config, there is nothing to apply', () => {
    expect(resolveDisplayView(null, displays)).toBeNull();
    expect(resolveDisplayView({ display: 'x', view: 'y' }, displays)).toBeNull();
  });

  it('a project without a complete pair applies nothing', () => {
    expect(resolveDisplayView({ configId: 'cfg', display: 'sRGB - Display' }, displays)).toBeNull();
    expect(resolveDisplayView({ configId: 'cfg', view: 'Raw' }, displays)).toBeNull();
  });

  it('returns the project pair', () => {
    expect(resolveDisplayView(project, displays)).toEqual({
      configId: 'cfg',
      display: 'sRGB - Display',
      view: 'ACES 1.0 - SDR Video',
    });
  });

  it('a project pair missing from the loaded config is no longer valid', () => {
    const stale = { configId: 'cfg', display: 'Gone - Display', view: 'Raw' };
    expect(resolveDisplayView(stale, displays)).toBeNull();
    // A view that disappeared from the config counts as much as a display that disappeared.
    expect(resolveDisplayView({ ...project, view: 'Gone - View' }, displays)).toBeNull();
    // While the list is not loaded, we trust the project.
    expect(resolveDisplayView(stale, [])).toMatchObject({ display: 'Gone - Display' });
  });
});
