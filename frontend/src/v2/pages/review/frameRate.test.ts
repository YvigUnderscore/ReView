// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { exactFrameRate, frameAtTime, frameRateFraction } from './frameRate';

describe('frameRateFraction — retrouver la cadence derrière son arrondi', () => {
  it('reconnaît les cadences NTSC rangées au centième', () => {
    expect(frameRateFraction(23.98)).toEqual({ num: 24000, den: 1001 });
    expect(frameRateFraction(29.97)).toEqual({ num: 30000, den: 1001 });
    expect(frameRateFraction(47.95)).toEqual({ num: 48000, den: 1001 });
    expect(frameRateFraction(59.94)).toEqual({ num: 60000, den: 1001 });
    expect(frameRateFraction(119.88)).toEqual({ num: 120000, den: 1001 });
  });

  it('ne confond jamais une cadence entière avec sa voisine fractionnaire', () => {
    expect(frameRateFraction(24)).toBeNull();
    expect(frameRateFraction(25)).toBeNull();
    expect(frameRateFraction(30)).toBeNull();
    expect(frameRateFraction(48)).toBeNull();
    expect(frameRateFraction(60)).toBeNull();
    expect(frameRateFraction(120)).toBeNull();
  });

  it('préfère la fraction relevée par la sonde quand le média la porte', () => {
    expect(frameRateFraction(23.98, { num: 24000, den: 1001 })).toEqual({ num: 24000, den: 1001 });
    // Cadence exotique : seule la sonde peut la donner, l'arrondi ne la désigne pas.
    expect(frameRateFraction(23.98, { num: 2997, den: 125 })).toEqual({ num: 2997, den: 125 });
  });

  it('ignore une fraction incomplète et une cadence absurde', () => {
    expect(frameRateFraction(24, { num: 24000 })).toBeNull();
    expect(frameRateFraction(null)).toBeNull();
    expect(frameRateFraction(0)).toBeNull();
    expect(frameRateFraction(Number.NaN)).toBeNull();
  });
});

describe('exactFrameRate', () => {
  it('corrige 23.98 en 23.976 et laisse les cadences justes intactes', () => {
    expect(exactFrameRate(23.98)).toBe(23.976);
    expect(exactFrameRate(29.97)).toBe(29.97);
    expect(exactFrameRate(59.94)).toBe(59.94);
    expect(exactFrameRate(25)).toBe(25);
    expect(exactFrameRate(24)).toBe(24);
  });

  it('reste lisible : trois décimales, pas dix-sept', () => {
    expect(String(exactFrameRate(23.98))).toBe('23.976');
    expect(String(exactFrameRate(47.95))).toBe('47.952');
  });

  it('retombe sur 24 quand aucune cadence n’est connue', () => {
    expect(exactFrameRate(null)).toBe(24);
    expect(exactFrameRate(undefined)).toBe(24);
    expect(exactFrameRate(-5)).toBe(24);
  });
});

describe('frameAtTime — la dérive que corrige la cadence exacte', () => {
  it('les deux cadences donnent la même frame sur un plan court', () => {
    expect(frameAtTime(3, 23.98)).toBe(frameAtTime(3, exactFrameRate(23.98)));
  });

  it('l’arrondi coûte une frame entière au bout de quatre minutes', () => {
    const t = 251; // 1 / 0,003976 s : l'écart atteint une frame pleine
    expect(frameAtTime(t, 23.98) - frameAtTime(t, exactFrameRate(23.98))).toBe(1);
  });

  it('la cadence corrigée colle à la fraction exacte sur un plan de dix-sept minutes', () => {
    const t = 1020;
    const truth = Math.round((t * 24000) / 1001);
    expect(frameAtTime(t, exactFrameRate(23.98))).toBe(truth);
    // Sans correction, quatre frames d'écart : le retour ne désigne plus la bonne image.
    expect(frameAtTime(t, 23.98) - truth).toBe(4);
  });

  it('borne les entrées incohérentes à la frame zéro', () => {
    expect(frameAtTime(-1, 24)).toBe(0);
    expect(frameAtTime(Number.NaN, 24)).toBe(0);
    expect(frameAtTime(10, 0)).toBe(0);
  });
});
