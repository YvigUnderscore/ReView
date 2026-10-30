// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
  buildPoiPart,
  MAX_POI_POINTS,
  poiBlock,
  poiContent,
  poiLine,
  readPoiPoints,
  stripPoiBlock,
} from './poiPoints';

const at = (x: number, text?: string) => ({
  position: `${x} 0 0`,
  normal: '0 0 1',
  space: 'object' as const,
  ...(text ? { text } : {}),
});

describe('readPoiPoints — a single part carries all the points', () => {
  it('reads the points back in their placement order (their number is their rank)', () => {
    const points = readPoiPoints([
      { type: 'poi', points: [at(0, 'un'), at(1, 'deux'), at(2)] },
      { type: 'path', pts: [] },
    ]);
    expect(points.map((p) => p.text)).toEqual(['un', 'deux', undefined]);
    expect(points[1].position).toBe('1 0 0');
  });

  it('reads back a comment predating this form as ONE point numbered "1"', () => {
    const points = readPoiPoints([{ type: 'hotspot', position: '1 2 3', normal: '0 1 0', space: 'object' }]);
    expect(points).toEqual([{ position: '1 2 3', normal: '0 1 0', space: 'object' }]);
  });

  it('returns nothing for an absent, empty or point-less annotation', () => {
    expect(readPoiPoints(null)).toEqual([]);
    expect(readPoiPoints([])).toEqual([]);
    expect(readPoiPoints([{ type: 'path' }])).toEqual([]);
    // Part present but unreadable: we fall back on the inherited hotspot if there is one.
    expect(readPoiPoints([{ type: 'poi', points: [{ normal: '0 0 1' }] }])).toEqual([]);
  });

  it('bounds the read-back to the same ceiling as the write', () => {
    const many = Array.from({ length: MAX_POI_POINTS + 5 }, (_, i) => at(i));
    expect(readPoiPoints([{ type: 'poi', points: many }])).toHaveLength(MAX_POI_POINTS);
  });
});

describe('buildPoiPart — nothing to attach without a point', () => {
  it('returns null when the list is empty', () => {
    expect(buildPoiPart([])).toBeNull();
  });

  it('returns a single part carrying all the points', () => {
    const part = buildPoiPart([at(0, 'un'), at(1, 'deux')]);
    expect(part?.type).toBe('poi');
    expect(part?.points).toHaveLength(2);
  });

  it('does not let more points through than the ceiling', () => {
    const many = Array.from({ length: MAX_POI_POINTS + 3 }, (_, i) => at(i));
    expect(buildPoiPart(many)?.points).toHaveLength(MAX_POI_POINTS);
  });
});

describe('poiContent / stripPoiBlock — the numbered block and its exact inverse', () => {
  it("numbers each remark at the tail of the author's text", () => {
    const content = poiContent('Deux soucis :', [at(0, 'la soudure'), at(1, 'le boulon')], '(annotation)');
    expect(content).toBe('Deux soucis :\n\n1. la soudure\n2. le boulon');
  });

  it("does without the author's text, and without the block when there is no point", () => {
    expect(poiContent('', [at(0, 'seul')], '(annotation)')).toBe('1. seul');
    expect(poiContent('   ', [], '(annotation)')).toBe('(annotation)');
    expect(poiContent('juste du texte', [], '(annotation)')).toBe('juste du texte');
  });

  it('numbers a point without remark: the number remains, it designates the hotspot', () => {
    expect(poiLine(2)).toBe('3.');
    expect(poiBlock([at(0), at(1, 'ici')])).toBe('1.\n2. ici');
  });

  it('removes exactly what `poiContent` added', () => {
    const points = [at(0, 'la soudure'), at(1, 'le boulon')];
    const content = poiContent('Deux soucis :', points, '(annotation)');
    expect(stripPoiBlock(content, points)).toBe('Deux soucis :');
    expect(stripPoiBlock(poiContent('', points, '(annotation)'), points)).toBe('');
  });

  it('touches nothing when the tail does not match (text edited by hand)', () => {
    const points = [at(0, 'la soudure')];
    expect(stripPoiBlock('un texte réécrit depuis', points)).toBe('un texte réécrit depuis');
    expect(stripPoiBlock('sans point', [])).toBe('sans point');
  });
});
