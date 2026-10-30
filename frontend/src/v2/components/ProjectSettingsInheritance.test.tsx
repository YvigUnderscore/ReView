// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ProjectSettingsInheritance from './ProjectSettingsInheritance';
import { overrideKey, type ProjectSettingsOverrideView } from '../lib/projectInheritance';
import type { ProjectSettings } from '../types/api';

/**
 * What the panel must say: which sections the project has taken over, and which
 * can be handed back to the studio. The assertions target the branches (displayed state, presence
 * of the return command), never the translated text.
 */

const STUDIO: ProjectSettings = {
  departments: [{ key: 'ANIM', name: 'Animation' }],
  nomenclature: { sequencePrefix: 'SQ', shotPrefix: 'SH', padding: 3, step: 10 },
  naming: { pattern: '', mode: 'off' },
  reviewRequest: { requireNote: false, minNoteLength: 5 },
  resolution: { width: 1920, height: 1080 },
  framerate: 24,
};

function render(view: ProjectSettingsOverrideView | undefined) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (view) qc.setQueryData(overrideKey(7), view);
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <ProjectSettingsInheritance projectId={7} onReverted={() => {}} />
    </QueryClientProvider>,
  );
}

/** Number of "hand back to studio" commands offered. */
const revertCount = (html: string) => (html.match(/<button/g) ?? []).length;

describe('ProjectSettingsInheritance', () => {
  it('offers NO return when the project inherits everything', () => {
    expect(revertCount(render({ override: {}, studio: STUDIO, overrides: [] }))).toBe(0);
  });

  it('offers the return only on the sections actually overridden', () => {
    const html = render({ override: { framerate: 25 }, studio: STUDIO, overrides: ['framerate'] });
    expect(revertCount(html)).toBe(1);
  });

  it('groups resolution and frame rate into a single format line', () => {
    const html = render({
      override: { framerate: 25, resolution: { width: 4096, height: 2160 } },
      studio: STUDIO,
      overrides: ['resolution', 'framerate'],
    });
    expect(revertCount(html)).toBe(1);
  });

  it('lists one row per group of sections', () => {
    const html = render({ override: {}, studio: STUDIO, overrides: [] });
    // A bare `<li` also counted the `<line>` elements of the SVG icons: the settings card
    // now carries an icon, and the count went up to nine without a line being added.
    // The pattern therefore requires a separator after the tag.
    expect((html.match(/<li[\s>]/g) ?? []).length).toBe(8);
  });

  it('shows a skeleton until the inheritance view has arrived', () => {
    const html = render(undefined);
    expect(revertCount(html)).toBe(0);
    expect(html).toContain('animate-pulse');
  });

  it('marks an overridden section with a state distinct from the inherited one', () => {
    const inherited = render({ override: {}, studio: STUDIO, overrides: [] });
    const overridden = render({
      override: { color: { configId: 'aces' } },
      studio: STUDIO,
      overrides: ['color'],
    });
    expect(inherited).not.toContain('text-warning');
    expect(overridden).toContain('text-warning');
  });
});
