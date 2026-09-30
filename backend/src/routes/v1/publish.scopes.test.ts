// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import publishRoutes from './publish.routes';

/**
 * Scopes réellement posés sur la publication, lus sur le routeur servi en production.
 *
 * Publier crée une version ET dépose un média : n'exiger que `versions:write` laissait un
 * token écrire dans le stockage sans l'avoir demandé, alors que `media:write` existait au
 * catalogue sans garder la moindre route. Le contrôle se fait sur la pile Express plutôt
 * que sur une relecture du fichier : c'est la déclaration effective qui compte.
 */

interface ScopedLayer {
  route?: {
    path: string;
    stack: { handle: { scopes?: readonly string[] } }[];
  };
}

const scopesOf = (path: string): readonly string[] => {
  const layers = (publishRoutes as unknown as { stack: ScopedLayer[] }).stack;
  const route = layers.find((l) => l.route?.path === path)?.route;
  expect(route, path).toBeDefined();
  return route!.stack.flatMap((s) => s.handle.scopes ?? []);
};

describe('scopes de la publication v1', () => {
  it('exige la version et le média à l’ouverture de la publication', () => {
    expect(scopesOf('/')).toEqual(['versions:write', 'media:write']);
  });

  it('les exige aussi à la finalisation, qui attache le fichier envoyé', () => {
    expect(scopesOf('/:id/complete')).toEqual(['versions:write', 'media:write']);
  });
});
