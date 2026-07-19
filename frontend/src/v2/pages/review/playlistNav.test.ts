import { describe, it, expect } from 'vitest';
import { carryParams, findPlayableNeighbor } from './playlistNav';
import type { PlaylistItemEntry } from '../../types/api';

const item = (id: number, hasMedia: boolean): PlaylistItemEntry => ({
  id,
  order: id,
  version: { id: id * 10, name: `V${id}`, location: '', mediaCount: hasMedia ? 1 : 0, reviewStatus: null },
  media: hasMedia ? { id: id * 100, kind: 'VIDEO', originalName: `m${id}.mov`, thumbnailUrl: null } : null,
});

describe('carryParams (33.A)', () => {
  it('ne propage que playlist et live (pas frame/comment)', () => {
    const sp = new URLSearchParams('playlist=4&live=1&frame=1012&comment=9');
    expect(carryParams(sp)).toBe('?playlist=4&live=1');
  });
  it('omet les paramètres absents', () => {
    expect(carryParams(new URLSearchParams('playlist=4'))).toBe('?playlist=4');
    expect(carryParams(new URLSearchParams(''))).toBe('?');
  });
});

describe('findPlayableNeighbor (33.A)', () => {
  const items = [item(1, true), item(2, false), item(3, true), item(4, true)];

  it('suivant : saute les versions sans média visible', () => {
    expect(findPlayableNeighbor(items, 0, 1)?.id).toBe(3);
    expect(findPlayableNeighbor(items, 2, 1)?.id).toBe(4);
  });
  it('précédent : idem en remontant', () => {
    expect(findPlayableNeighbor(items, 2, -1)?.id).toBe(1);
  });
  it('bords et index inconnu → null', () => {
    expect(findPlayableNeighbor(items, 3, 1)).toBeNull();
    expect(findPlayableNeighbor(items, 0, -1)).toBeNull();
    expect(findPlayableNeighbor(items, -1, 1)).toBeNull();
  });
});
