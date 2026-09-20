// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { mediaReviewAspect, reviewAspect, reviewAspectLabel } from './reviewAspect';
import { DEFAULT_REVIEW_ASPECT } from './frameRect';

/**
 * Le ratio du cadre de review : réglages pipeline par défaut, présentation enregistrée d'abord.
 *
 * Les deux moitiés de la règle comptent autant l'une que l'autre. Sans la première, un projet
 * qui livre en scope reviewait en 16/9 ; sans la seconde, appliquer le ratio du projet à un
 * média déjà annoté déplacerait à l'écran des annotations posées sur des reviews validées.
 */
describe('reviewAspect', () => {
  it('prend le ratio de livraison hérité quand rien n’est enregistré', () => {
    expect(reviewAspect({ delivery: 2.39 })).toEqual({ value: 2.39, frozen: false });
  });

  it('laisse l’aspect DÉJÀ enregistré primer sur le ratio du projet', () => {
    expect(reviewAspect({ presentation: 2.39, delivery: 16 / 9 })).toEqual({ value: 2.39, frozen: true });
  });

  it('retombe sur 16:9 quand ni la présentation ni le détail ne donnent de ratio', () => {
    expect(reviewAspect({})).toEqual({ value: DEFAULT_REVIEW_ASPECT, frozen: false });
  });

  // Un aspect aberrant (présentation ancienne, réglage corrompu) ferait un cadre de hauteur
  // nulle : on le traite comme absent plutôt que de vider le viewer.
  it('ignore un ratio dégénéré, des deux côtés', () => {
    expect(reviewAspect({ presentation: 0, delivery: 2.39 })).toEqual({ value: 2.39, frozen: false });
    expect(reviewAspect({ presentation: Number.NaN, delivery: 2.39 })).toEqual({
      value: 2.39,
      frozen: false,
    });
    expect(reviewAspect({ presentation: null, delivery: Number.POSITIVE_INFINITY })).toEqual({
      value: DEFAULT_REVIEW_ASPECT,
      frozen: false,
    });
  });
});

describe('mediaReviewAspect — la règle prise sur un détail de média', () => {
  it('sert le ratio hérité d’un média sans mise en scène', () => {
    expect(mediaReviewAspect({ splatPresentation: null, deliveryAspect: 1.85 })).toEqual({
      value: 1.85,
      frozen: false,
    });
  });

  it('respecte le cadre gelé d’un média déjà mis en scène', () => {
    const data = { splatPresentation: { camera: { aspect: 4 / 3 } }, deliveryAspect: 1.85 };
    expect(mediaReviewAspect(data)).toEqual({ value: 4 / 3, frozen: true });
  });

  // Le détail n'est pas encore chargé : le viewer se monte quand même, sur un cadre neutre.
  it('tient devant un détail absent', () => {
    expect(mediaReviewAspect(undefined)).toEqual({ value: DEFAULT_REVIEW_ASPECT, frozen: false });
  });
});

describe('reviewAspectLabel', () => {
  it('nomme les formats connus', () => {
    expect(reviewAspectLabel(16 / 9)).toBe('16:9');
    expect(reviewAspectLabel(4 / 3)).toBe('4:3');
    expect(reviewAspectLabel(1)).toBe('1:1');
  });

  // Une résolution réelle de pipeline n'est jamais exactement le format qu'elle annonce.
  it('reconnaît un format à la résolution près (2048×858 = scope)', () => {
    expect(reviewAspectLabel(2048 / 858)).toBe('2.39:1');
    expect(reviewAspectLabel(1998 / 1080)).toBe('1.85:1');
    expect(reviewAspectLabel(3840 / 2160)).toBe('16:9');
  });

  it('chiffre un ratio inhabituel plutôt que de le rapprocher de force', () => {
    expect(reviewAspectLabel(2)).toBe('2.00:1');
    expect(reviewAspectLabel(1.43)).toBe('1.43:1');
  });

  it('retombe sur 16:9 devant un ratio dégénéré', () => {
    expect(reviewAspectLabel(0)).toBe('16:9');
    expect(reviewAspectLabel(Number.NaN)).toBe('16:9');
  });
});
