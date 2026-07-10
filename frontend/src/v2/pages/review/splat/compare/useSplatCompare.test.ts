import { describe, expect, it } from 'vitest';
import type { MediaSummary } from '../../../../types/api';
import { sideBySideOffsets, splatSiblings } from './useSplatCompare';

describe('sideBySideOffsets', () => {
  it('centre les positions et espace régulièrement', () => {
    expect(sideBySideOffsets(1, 4)).toEqual([0]);
    expect(sideBySideOffsets(2, 4)).toEqual([-2, 2]);
    expect(sideBySideOffsets(3, 4)).toEqual([-4, 0, 4]);
  });
});

describe('splatSiblings', () => {
  const media = [
    { id: 1, kind: 'SPLAT', status: 'READY', originalName: 'a.sog', published: true },
    { id: 2, kind: 'VIDEO', status: 'READY', originalName: 'b.mp4', published: true },
    { id: 3, kind: 'SPLAT', status: 'PROCESSING', originalName: 'c.ply', published: true },
    { id: 4, kind: 'SPLAT', status: 'READY', originalName: 'd.spz', published: false },
  ] as MediaSummary[];

  it('ne garde que les splats prêts (mono-média → comparaison inactive)', () => {
    expect(splatSiblings(media).map((m) => m.id)).toEqual([1, 4]);
    // Garde mono-média : un seul splat prêt → pas de comparaison (enabled = length > 1).
    expect(splatSiblings([media[0], media[1]])).toHaveLength(1);
  });
});
