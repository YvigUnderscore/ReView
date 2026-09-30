// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { buildPoiSceneCards, poiCardAbove, poiCardSide, POI_CARD_HALF_PX } from './poiCards';
import type { PoiPoint } from './poiPoints';

const attachments = [
  { key: 'k1', name: 'soudure.png', contentType: 'image/png', url: 'blob:soudure' },
  { key: 'k2', name: 'boulon.png', contentType: 'image/png', url: 'blob:boulon' },
  { key: 'k3', name: 'note.pdf', contentType: 'application/pdf', url: 'blob:pdf' },
];

const points: PoiPoint[] = [
  { position: '0 0 0', normal: '0 0 1', space: 'object', text: 'la soudure se voit', images: ['k1'] },
  { position: '1 0 0', normal: '0 0 1', space: 'object', text: 'le boulon dépasse' },
];

describe('buildPoiSceneCards — le commentaire relu, réparti sur ses points', () => {
  it('donne à chaque point sa remarque et SES images, reconnues par leur clé', () => {
    const cards = buildPoiSceneCards({ points, attachments });
    expect(cards.map((c) => c.index)).toEqual([0, 1]);
    expect(cards[0].text).toBe('la soudure se voit');
    expect(cards[0].images.map((i) => i.alt)).toEqual(['soudure.png', 'boulon.png']);
    expect(cards[1].text).toBe('le boulon dépasse');
    expect(cards[1].images).toEqual([]);
  });

  it('pose sur la PREMIÈRE carte le mot de l’auteur et les images qu’aucun point ne réclame', () => {
    const cards = buildPoiSceneCards({
      points,
      attachments,
      intro: '  revoir la passe de rendu  ',
      author: 'Lou',
    });
    expect(cards[0].intro).toBe('revoir la passe de rendu');
    expect(cards[0].author).toBe('Lou');
    // `k2` n'appartient à aucun point : elle rejoint la première carte. `k3` est un PDF.
    expect(cards[0].images.map((i) => i.src)).toEqual(['blob:soudure', 'blob:boulon']);
    expect(cards[1].intro).toBeUndefined();
    expect(cards[1].author).toBeUndefined();
  });

  it('ne pose pas de carte sur un point qui n’a rien à lire', () => {
    const bare: PoiPoint[] = [
      { position: '0 0 0', normal: '0 0 1' },
      { position: '1 0 0', normal: '0 0 1', text: 'ici' },
    ];
    const cards = buildPoiSceneCards({ points: bare });
    expect(cards.map((c) => c.index)).toEqual([1]);
  });

  it('rend lisible un commentaire d’avant les points : son unique point porte tout', () => {
    // `readPoiPoints` rend le `hotspot` d'un ancien commentaire comme point n° 1, sans texte.
    const legacy: PoiPoint[] = [{ position: '0 0 0', normal: '0 0 1' }];
    const cards = buildPoiSceneCards({
      points: legacy,
      attachments,
      intro: 'le raccord saute',
      author: 'Lou',
    });
    expect(cards).toHaveLength(1);
    expect(cards[0].intro).toBe('le raccord saute');
    expect(cards[0].images).toHaveLength(2);
  });

  it('ne garde des pièces jointes que les images affichables', () => {
    const [card] = buildPoiSceneCards({
      points: [{ position: '0 0 0', normal: '0 0 1', text: 'un défaut', images: ['k3'] }],
      attachments: [attachments[2]],
    });
    // Le PDF du commentaire se lit dans le fil, pas en vignette au-dessus de la scène.
    expect(card.images).toEqual([]);
    expect(card.text).toBe('un défaut');
  });
});

describe('poiCardSide — la carte ouverte tient dans le viewer, qui écrête ce qui dépasse', () => {
  it('se centre sous sa pastille quand la place ne manque d’aucun côté', () => {
    expect(poiCardSide(400, 800)).toBe('center');
  });

  it('se pousse à droite près du bord gauche, à gauche près du bord droit', () => {
    expect(poiCardSide(10, 800)).toBe('right');
    expect(poiCardSide(790, 800)).toBe('left');
  });

  it('bascule exactement à la demi-largeur de la carte', () => {
    expect(poiCardSide(POI_CARD_HALF_PX - 1, 800)).toBe('right');
    expect(poiCardSide(POI_CARD_HALF_PX, 800)).toBe('center');
  });
});

describe('poiCardAbove — un point au ras du bord bas se commente au-dessus', () => {
  it('reste sous sa pastille tant que la carte tient dessous', () => {
    expect(poiCardAbove(100, 900)).toBe(false);
  });

  it('passe au-dessus quand la place manque dessous et qu’il y en a plus dessus', () => {
    expect(poiCardAbove(860, 900)).toBe(true);
  });

  it('ne passe pas au-dessus dans un viewer trop court pour elle : deux bords écrêtent pareil', () => {
    // 120 px sous la pastille, 30 px dessus : monter la carte n'y gagnerait rien.
    expect(poiCardAbove(30, 150)).toBe(false);
  });
});
