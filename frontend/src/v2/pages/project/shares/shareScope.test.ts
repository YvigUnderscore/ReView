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
 * La portée décide de ce qu'un inconnu muni d'un jeton peut voir. Côté écran, l'enjeu est
 * de ne jamais envoyer une portée à moitié choisie, et de ne jamais faire passer un lien
 * restreint pour un lien de projet dans la liste.
 */
describe('isScopeReady', () => {
  it('accepte le projet entier sans autre choix', () => {
    expect(isScopeReady(emptyScope)).toBe(true);
  });

  it('exige la cible des portées restreintes', () => {
    expect(isScopeReady({ ...emptyScope, scope: 'PLAYLIST' })).toBe(false);
    expect(isScopeReady({ ...emptyScope, scope: 'PLAYLIST', playlistId: 3 })).toBe(true);
    expect(isScopeReady({ ...emptyScope, scope: 'VERSION' })).toBe(false);
    expect(isScopeReady({ ...emptyScope, scope: 'VERSION', versionId: 8 })).toBe(true);
    expect(isScopeReady({ ...emptyScope, scope: 'MEDIA' })).toBe(false);
    expect(isScopeReady({ ...emptyScope, scope: 'MEDIA', mediaIds: [1] })).toBe(true);
  });
});

describe('scopePayload', () => {
  // Envoyer les trois cibles laisserait le serveur arbitrer : la contrainte SQL exige
  // qu'une portée n'en porte qu'une.
  it("n'envoie que la cible de la portée choisie", () => {
    const full = { scope: 'PLAYLIST' as const, playlistId: 3, versionId: 8, mediaIds: [1, 2] };
    expect(scopePayload(full)).toEqual({ scope: 'PLAYLIST', playlistId: 3 });
    expect(scopePayload({ ...full, scope: 'VERSION' })).toEqual({ scope: 'VERSION', versionId: 8 });
    expect(scopePayload({ ...full, scope: 'MEDIA' })).toEqual({ scope: 'MEDIA', mediaIds: [1, 2] });
    expect(scopePayload({ ...full, scope: 'PROJECT' })).toEqual({ scope: 'PROJECT' });
  });
});

describe('toggleMedia', () => {
  it('ajoute, retire, et ne mute pas la liste reçue', () => {
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

  it('dédoublonne les versions en gardant leur ordre', () => {
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
  it('accepte les séparateurs usuels et dédoublonne', () => {
    expect(parseRecipients('a@b.fr\nc@d.com, a@b.fr ; e@f.io')).toEqual(['a@b.fr', 'c@d.com', 'e@f.io']);
  });

  it('écarte ce qui n’est pas une adresse', () => {
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

  it('nomme la cible plutôt que la portée', () => {
    expect(scopeBadge(link({ scope: 'PLAYLIST', playlist: { name: 'Reel 1' } }), labels)).toBe('Reel 1');
    expect(scopeBadge(link({ scope: 'VERSION', version: { name: 'V04' } }), labels)).toBe('V04');
    expect(scopeBadge(link({ scope: 'MEDIA', mediaIds: [1, 2, 3] }), labels)).toBe('3 media');
    expect(scopeBadge(link({}), labels)).toBe('Whole project');
  });

  // Un lien restreint dont la cible manque ne doit surtout pas s'annoncer « projet entier ».
  it('n’annonce jamais le projet entier pour une portée restreinte', () => {
    expect(scopeBadge(link({ scope: 'PLAYLIST' }), labels)).toBe('Restricted');
    expect(scopeBadge(link({ scope: 'VERSION' }), labels)).toBe('Restricted');
  });
});
