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

describe('readPoiPoints — une seule part porte tous les points', () => {
  it('relit les points dans leur ordre de pose (leur numéro est leur rang)', () => {
    const points = readPoiPoints([
      { type: 'poi', points: [at(0, 'un'), at(1, 'deux'), at(2)] },
      { type: 'path', pts: [] },
    ]);
    expect(points.map((p) => p.text)).toEqual(['un', 'deux', undefined]);
    expect(points[1].position).toBe('1 0 0');
  });

  it('relit un commentaire d’avant cette forme comme UN point numéroté « 1 »', () => {
    const points = readPoiPoints([{ type: 'hotspot', position: '1 2 3', normal: '0 1 0', space: 'object' }]);
    expect(points).toEqual([{ position: '1 2 3', normal: '0 1 0', space: 'object' }]);
  });

  it('ne rend rien d’une annotation absente, vide ou sans point', () => {
    expect(readPoiPoints(null)).toEqual([]);
    expect(readPoiPoints([])).toEqual([]);
    expect(readPoiPoints([{ type: 'path' }])).toEqual([]);
    // Part présente mais illisible : on retombe sur le hotspot hérité s'il y en a un.
    expect(readPoiPoints([{ type: 'poi', points: [{ normal: '0 0 1' }] }])).toEqual([]);
  });

  it('borne la relecture au même plafond que l’écriture', () => {
    const many = Array.from({ length: MAX_POI_POINTS + 5 }, (_, i) => at(i));
    expect(readPoiPoints([{ type: 'poi', points: many }])).toHaveLength(MAX_POI_POINTS);
  });
});

describe('buildPoiPart — rien à joindre sans point', () => {
  it('rend null quand la liste est vide', () => {
    expect(buildPoiPart([])).toBeNull();
  });

  it('rend une part unique qui porte tous les points', () => {
    const part = buildPoiPart([at(0, 'un'), at(1, 'deux')]);
    expect(part?.type).toBe('poi');
    expect(part?.points).toHaveLength(2);
  });

  it('ne laisse pas passer plus de points que le plafond', () => {
    const many = Array.from({ length: MAX_POI_POINTS + 3 }, (_, i) => at(i));
    expect(buildPoiPart(many)?.points).toHaveLength(MAX_POI_POINTS);
  });
});

describe('poiContent / stripPoiBlock — le bloc numéroté et son inverse exact', () => {
  it('numérote chaque remarque à la queue du texte de l’auteur', () => {
    const content = poiContent('Deux soucis :', [at(0, 'la soudure'), at(1, 'le boulon')], '(annotation)');
    expect(content).toBe('Deux soucis :\n\n1. la soudure\n2. le boulon');
  });

  it('se passe du texte de l’auteur, et du bloc quand il n’y a aucun point', () => {
    expect(poiContent('', [at(0, 'seul')], '(annotation)')).toBe('1. seul');
    expect(poiContent('   ', [], '(annotation)')).toBe('(annotation)');
    expect(poiContent('juste du texte', [], '(annotation)')).toBe('juste du texte');
  });

  it('numérote un point sans remarque : le numéro reste, il désigne la pastille', () => {
    expect(poiLine(2)).toBe('3.');
    expect(poiBlock([at(0), at(1, 'ici')])).toBe('1.\n2. ici');
  });

  it('retire exactement ce que `poiContent` a ajouté', () => {
    const points = [at(0, 'la soudure'), at(1, 'le boulon')];
    const content = poiContent('Deux soucis :', points, '(annotation)');
    expect(stripPoiBlock(content, points)).toBe('Deux soucis :');
    expect(stripPoiBlock(poiContent('', points, '(annotation)'), points)).toBe('');
  });

  it('ne touche à rien quand la queue ne correspond pas (texte édité à la main)', () => {
    const points = [at(0, 'la soudure')];
    expect(stripPoiBlock('un texte réécrit depuis', points)).toBe('un texte réécrit depuis');
    expect(stripPoiBlock('sans point', [])).toBe('sans point');
  });
});
