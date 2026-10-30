// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import publishRoutes from './publish.routes';

/**
 * Scopes actually set on the publication, read from the router served in production.
 *
 * Publishing creates a version AND uploads a media: requiring only `versions:write` let a token
 * write to storage without having asked for it, while `media:write` existed in the catalogue without
 * guarding any route. The check runs on the Express stack rather than on a re-read of the file: the
 * effective declaration is what counts.
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

describe('v1 publish scopes', () => {
  it('requires the version and media scopes when opening the publication', () => {
    expect(scopesOf('/')).toEqual(['versions:write', 'media:write']);
  });

  it('requires them too at finalization, which attaches the uploaded file', () => {
    expect(scopesOf('/:id/complete')).toEqual(['versions:write', 'media:write']);
  });
});
