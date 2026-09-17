// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { buildGuestAnnotation, frameOf, guestCommentContent } from './clientAnnotation';
import { splitAnnotationParts } from '../review/reviewTypes';
import type { Shape } from '../../components/AnnotationCanvas';

const rect: Shape = { id: 'a', type: 'rect', color: '#ef4444', width: 3, x: 0.1, y: 0.1, w: 0.2, h: 0.2 };

describe('buildGuestAnnotation — ce que l’invité joint à son retour', () => {
  it('ne joint rien quand il n’y a ni dessin ni point', () => {
    expect(buildGuestAnnotation({ shapes: [] })).toBeUndefined();
    expect(buildGuestAnnotation({ shapes: [], hotspot: null })).toBeUndefined();
  });

  it('joint les formes telles quelles', () => {
    expect(buildGuestAnnotation({ shapes: [rect] })).toEqual([rect]);
  });

  // `splitAnnotationParts` n'en retient qu'un : l'ordre décide lequel, comme en interne.
  it('place le point de surface en tête des formes', () => {
    const parts = buildGuestAnnotation({
      shapes: [rect],
      hotspot: { position: '1,2,3', normal: '0,1,0', space: 'object' },
    });
    expect(parts?.[0]).toEqual({ type: 'hotspot', position: '1,2,3', normal: '0,1,0', space: 'object' });
    expect(parts?.[1]).toEqual(rect);
  });

  it('omet l’espace quand le hotspot n’en déclare pas', () => {
    const parts = buildGuestAnnotation({ shapes: [], hotspot: { position: '1,2,3', normal: '0,1,0' } });
    expect(parts?.[0]).toEqual({ type: 'hotspot', position: '1,2,3', normal: '0,1,0' });
  });

  /**
   * Le contrat qui compte vraiment : le retour d'un client se rouvre dans la review de
   * l'artiste. Ce que l'invité écrit doit donc se relire avec le MÊME lecteur que l'interne.
   */
  it('produit un format que la review interne relit', () => {
    const parts = buildGuestAnnotation({
      shapes: [rect],
      hotspot: { position: '1,2,3', normal: '0,1,0' },
    });
    const read = splitAnnotationParts(parts);
    expect(read.shapes).toEqual([rect]);
    expect(read.hotspot).toEqual({ position: '1,2,3', normal: '0,1,0', space: undefined });
  });
});

describe('guestCommentContent — un dessin seul vaut un retour', () => {
  it('garde le texte de l’invité, débarrassé de ses espaces', () => {
    expect(guestCommentContent('  trop sombre  ', undefined)).toBe('trop sombre');
  });

  // Le serveur exige un contenu : sans repli, un dessin seul serait refusé en 400.
  it('remplace un texte vide par un repli dès qu’il y a une annotation', () => {
    expect(guestCommentContent('', [rect])).toBe('(annotation)');
    expect(guestCommentContent('   ', [rect])).toBe('(annotation)');
  });

  it('ne renvoie rien quand il n’y a ni texte ni dessin', () => {
    expect(guestCommentContent('', undefined)).toBeNull();
  });
});

describe('frameOf — le numéro que l’invité cite au studio', () => {
  it('compte dans la numérotation du projet, pas depuis zéro', () => {
    expect(frameOf(0, 24, 1001)).toBe(1001);
    expect(frameOf(1, 24, 1001)).toBe(1025);
  });

  // Une cadence fractionnaire est le cas courant en production, pas une exception.
  it('arrondit à l’image la plus proche sur une cadence fractionnaire', () => {
    expect(frameOf(1, 23.976, 1)).toBe(25);
  });

  it('ne descend jamais sous la première frame', () => {
    expect(frameOf(-5, 24, 1001)).toBe(1001);
  });

  // Cadence inconnue : mieux vaut la première frame qu'un NaN affiché au client.
  it('retombe sur la première frame quand la cadence est inexploitable', () => {
    expect(frameOf(10, 0, 1001)).toBe(1001);
    expect(frameOf(10, Number.NaN, 1001)).toBe(1001);
  });
});
