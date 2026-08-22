// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ProjectSettingsInheritance from './ProjectSettingsInheritance';
import { overrideKey, type ProjectSettingsOverrideView } from '../lib/projectInheritance';
import type { ProjectSettings } from '../types/api';

/**
 * Ce que le panneau doit dire : quelles sections le projet s'est appropriées, et laquelle
 * on peut rendre au studio. Les assertions portent sur les branches (état affiché, présence
 * de la commande de retour), jamais sur le texte traduit.
 */

const STUDIO: ProjectSettings = {
  departments: [{ key: 'ANIM', name: 'Animation' }],
  nomenclature: { sequencePrefix: 'SQ', shotPrefix: 'SH', padding: 3, step: 10 },
  naming: { pattern: '', mode: 'off' },
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

/** Nombre de commandes « rendre au studio » offertes. */
const revertCount = (html: string) => (html.match(/<button/g) ?? []).length;

describe('ProjectSettingsInheritance', () => {
  it('n’offre AUCUN retour quand le projet hérite de tout', () => {
    expect(revertCount(render({ override: {}, studio: STUDIO, overrides: [] }))).toBe(0);
  });

  it('n’offre le retour que sur les sections réellement surchargées', () => {
    const html = render({ override: { framerate: 25 }, studio: STUDIO, overrides: ['framerate'] });
    expect(revertCount(html)).toBe(1);
  });

  it('regroupe résolution et cadence en une seule ligne de format', () => {
    const html = render({
      override: { framerate: 25, resolution: { width: 4096, height: 2160 } },
      studio: STUDIO,
      overrides: ['resolution', 'framerate'],
    });
    expect(revertCount(html)).toBe(1);
  });

  it('liste une ligne par groupe de sections', () => {
    const html = render({ override: {}, studio: STUDIO, overrides: [] });
    expect((html.match(/<li/g) ?? []).length).toBe(7);
  });

  it('affiche un squelette tant que la vue d’héritage n’est pas arrivée', () => {
    const html = render(undefined);
    expect(revertCount(html)).toBe(0);
    expect(html).toContain('animate-pulse');
  });

  it('marque une section surchargée d’un état distinct de l’hérité', () => {
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
