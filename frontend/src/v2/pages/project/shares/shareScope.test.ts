// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
  emptyScope,
  isScopeReady,
  parseRecipients,
  scopeBadge,
  scopePayload,
  toggleMedia,
  versionsOf,
  type ScopedShareLink,
  type ShareCandidate,
} from './shareScope';

/**
 * The scope decides what a stranger holding a token can see. On screen, the stake is never to send
 * a half-chosen scope, and never to let a restricted link pass for a project link in the list.
 */
describe('isScopeReady', () => {
  it('accepts the whole project without any other choice', () => {
    expect(isScopeReady(emptyScope)).toBe(true);
  });

  it('requires the target of restricted scopes', () => {
    expect(isScopeReady({ ...emptyScope, scope: 'PLAYLIST' })).toBe(false);
    expect(isScopeReady({ ...emptyScope, scope: 'PLAYLIST', playlistId: 3 })).toBe(true);
    expect(isScopeReady({ ...emptyScope, scope: 'VERSION' })).toBe(false);
    expect(isScopeReady({ ...emptyScope, scope: 'VERSION', versionId: 8 })).toBe(true);
    expect(isScopeReady({ ...emptyScope, scope: 'MEDIA' })).toBe(false);
    expect(isScopeReady({ ...emptyScope, scope: 'MEDIA', mediaIds: [1] })).toBe(true);
  });
});

describe('scopePayload', () => {
  // Sending all three targets would leave the server to arbitrate: the SQL constraint requires
  // that a scope carry only one.
  it('sends only the target of the chosen scope', () => {
    const full = { scope: 'PLAYLIST' as const, playlistId: 3, versionId: 8, mediaIds: [1, 2] };
    expect(scopePayload(full)).toEqual({ scope: 'PLAYLIST', playlistId: 3 });
    expect(scopePayload({ ...full, scope: 'VERSION' })).toEqual({ scope: 'VERSION', versionId: 8 });
    expect(scopePayload({ ...full, scope: 'MEDIA' })).toEqual({ scope: 'MEDIA', mediaIds: [1, 2] });
    expect(scopePayload({ ...full, scope: 'PROJECT' })).toEqual({ scope: 'PROJECT' });
  });
});

describe('toggleMedia', () => {
  it('adds, removes, and does not mutate the list received', () => {
    const initial = [1, 2];
    expect(toggleMedia(initial, 3)).toEqual([1, 2, 3]);
    expect(toggleMedia(initial, 2)).toEqual([1]);
    expect(initial).toEqual([1, 2]);
  });
});

describe('versionsOf', () => {
  const candidate = (id: number, versionId: number, location: string): ShareCandidate => ({
    id,
    originalName: `plate_${id}.mov`,
    kind: 'VIDEO',
    versionId,
    versionName: 'V02',
    location,
    createdAt: '2026-08-20T10:00:00.000Z',
  });

  it('deduplicates versions while keeping their order', () => {
    const list = versionsOf([
      candidate(1, 10, 'SH010 › comp'),
      candidate(2, 10, 'SH010 › comp'),
      candidate(3, 11, 'SH020 › comp'),
    ]);
    expect(list).toEqual([
      { id: 10, label: 'SH010 › comp · V02' },
      { id: 11, label: 'SH020 › comp · V02' },
    ]);
  });
});

describe('parseRecipients', () => {
  it('accepts the usual separators and deduplicates', () => {
    expect(parseRecipients('a@b.fr\nc@d.com, a@b.fr ; e@f.io')).toEqual(['a@b.fr', 'c@d.com', 'e@f.io']);
  });

  it('discards what is not an address', () => {
    expect(parseRecipients('   \n;;\nplop\na@b')).toEqual([]);
  });
});

describe('scopeBadge', () => {
  const labels = {
    project: 'Whole project',
    selection: (count: number) => `${count} media`,
    restricted: 'Restricted',
  };
  const link = (over: Partial<ScopedShareLink>) =>
    ({ scope: 'PROJECT', playlist: null, version: null, mediaIds: [], ...over }) as ScopedShareLink;

  it('names the target rather than the scope', () => {
    expect(scopeBadge(link({ scope: 'PLAYLIST', playlist: { name: 'Reel 1' } }), labels)).toBe('Reel 1');
    expect(scopeBadge(link({ scope: 'VERSION', version: { name: 'V04' } }), labels)).toBe('V04');
    expect(scopeBadge(link({ scope: 'MEDIA', mediaIds: [1, 2, 3] }), labels)).toBe('3 media');
    expect(scopeBadge(link({}), labels)).toBe('Whole project');
  });

  // A restricted link whose target is missing must above all not announce itself as "whole project".
  it('never announces the whole project for a restricted scope', () => {
    expect(scopeBadge(link({ scope: 'PLAYLIST' }), labels)).toBe('Restricted');
    expect(scopeBadge(link({ scope: 'VERSION' }), labels)).toBe('Restricted');
  });
});
