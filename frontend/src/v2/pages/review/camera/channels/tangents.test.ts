// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { emptyAnim, upsertKey, type CameraAnimV2, type CurveKey, type KeyRef } from './model';
import { evalChannel } from './hermite';
import {
  channelRefs,
  clampWeight,
  handleSpanMs,
  isBroken,
  isWeighted,
  setBroken,
  setTangentSlope,
  setTangentType,
  setWeighted,
  slopeIn,
  slopeOut,
  typeIn,
  typeOut,
  weightFromSpan,
} from './tangents';

/** Trois clés asymétriques : la pente lissée de la clé du milieu ne vaut PAS zéro. */
function asymmetric(): CameraAnimV2 {
  let a = upsertKey(emptyAnim(), 'px', 0, 0);
  a = upsertKey(a, 'px', 1000, 10);
  return upsertKey(a, 'px', 2000, 30);
}

const middle: KeyRef[] = [{ channel: 'px', index: 1 }];
const keysOf = (a: CameraAnimV2): CurveKey[] => a.channels.px?.keys ?? [];
const key = (a: CameraAnimV2, i = 1): CurveKey => keysOf(a)[i];

/** Relecture « ancienne » : on retire les côtés séparés et on ne garde que le mode unifié. */
function asLegacy(a: CameraAnimV2): CameraAnimV2 {
  const keys = keysOf(a).map((k) => {
    const copy: CurveKey = { ...k };
    delete copy.modeIn;
    delete copy.modeOut;
    delete copy.broken;
    return copy;
  });
  return { ...a, channels: { px: { keys } } };
}

describe('tangents — types par côté', () => {
  it('un côté absent retombe sur le mode unifié (données d’avant les côtés séparés)', () => {
    const k: CurveKey = { t: 0, v: 0, mode: 'linear' };
    expect(typeIn(k)).toBe('linear');
    expect(typeOut(k)).toBe('linear');
    expect(typeIn({ ...k, modeIn: 'flat' })).toBe('flat');
    expect(typeOut({ ...k, modeIn: 'flat' })).toBe('linear');
  });

  it('les pentes lues reprennent les formules d’origine (auto, linear, step, free)', () => {
    const keys = keysOf(asymmetric());
    // auto = Catmull-Rom sur les voisins : (30 − 0) / 2000.
    expect(slopeOut(keys, 1)).toBeCloseTo(0.015, 9);
    expect(slopeIn(keys, 1)).toBeCloseTo(0.015, 9);
    // linear : la corde vers le voisin du côté considéré.
    const lin = keys.map((k) => ({ ...k, mode: 'linear' as const }));
    expect(slopeOut(lin, 1)).toBeCloseTo(0.02, 9);
    expect(slopeIn(lin, 1)).toBeCloseTo(0.01, 9);
    // free : les poignées écrites ; step garde la pente lissée (le palier court-circuite la lecture).
    const free = keys.map((k) => ({ ...k, mode: 'free' as const, tin: 0.5, tout: -0.5 }));
    expect(slopeIn(free, 1)).toBe(0.5);
    expect(slopeOut(free, 1)).toBe(-0.5);
    const step = keys.map((k) => ({ ...k, mode: 'step' as const }));
    expect(slopeOut(step, 1)).toBeCloseTo(0.015, 9);
  });

  it('flat impose une pente nulle du côté visé seulement', () => {
    const a = setTangentType(asymmetric(), middle, 'flat', 'out');
    const keys = keysOf(a);
    expect(slopeOut(keys, 1)).toBe(0);
    expect(slopeIn(keys, 1)).toBeCloseTo(0.015, 9);
    expect(isBroken(key(a))).toBe(true);
  });
});

describe('tangents — poignée tirée (le défaut corrigé)', () => {
  it('clé unifiée : les deux côtés suivent la pente tirée', () => {
    const a = setTangentSlope(asymmetric(), 'px', 1, 'out', 0.02);
    const k = key(a);
    expect(k.tout).toBeCloseTo(0.02, 9);
    expect(k.tin).toBeCloseTo(0.02, 9);
    expect(k.mode).toBe('free');
  });

  it('clé brisée : le côté non tiré garde la pente que la lecture calculait déjà', () => {
    const base = asymmetric();
    const broken = setBroken(base, middle, true);
    const a = setTangentSlope(broken, 'px', 1, 'out', 0.02);
    const k = key(a);
    // Matérialisé à 0,015 (la pente lissée), et NON laissé indéfini — relu comme 0, il aplatissait
    // brutalement le segment entrant.
    expect(k.tin).toBeCloseTo(0.015, 9);
    expect(k.tout).toBeCloseTo(0.02, 9);
    // Le segment entrant est inchangé, au flottant près.
    for (const t of [200, 500, 900]) {
      expect(evalChannel(a.channels.px, t, 0)).toBeCloseTo(evalChannel(base.channels.px, t, 0), 9);
    }
  });

  it('un palier voisin n’est pas emporté par la poignée jumelle', () => {
    const stepped = setTangentType(asymmetric(), middle, 'step');
    const a = setTangentSlope(stepped, 'px', 1, 'in', 0.03);
    expect(typeOut(key(a))).toBe('step');
    expect(key(a).mode).toBe('step');
  });

  it('sur une clé absente, rien n’est écrit', () => {
    const a = asymmetric();
    expect(setTangentSlope(a, 'px', 42, 'out', 1)).toEqual(a);
  });
});

describe('tangents — invariant de relecture ancienne', () => {
  it.each([
    ['flat', 700],
    ['free', 700],
    ['linear', 1500],
  ] as const)('un profil %s se relit à l’identique sans les côtés séparés', (type, at) => {
    const a = setTangentType(asymmetric(), middle, type);
    expect(evalChannel(asLegacy(a).channels.px, at, 0)).toBeCloseTo(evalChannel(a.channels.px, at, 0), 9);
  });

  it('un profil sur les deux côtés unifie, sur un seul côté brise', () => {
    const both = setTangentType(asymmetric(), middle, 'flat');
    expect(isBroken(key(both))).toBe(false);
    const one = setTangentType(both, middle, 'linear', 'in');
    expect(isBroken(key(one))).toBe(true);
    expect(typeIn(key(one))).toBe('linear');
    expect(typeOut(key(one))).toBe('flat');
  });

  it('step ne s’écrit que du côté sortant, même demandé côté entrant', () => {
    const a = setTangentType(asymmetric(), middle, 'step', 'in');
    expect(typeOut(key(a))).toBe('step');
    expect(key(a).modeIn).toBeUndefined();
    // Le côté entrant reste lissé — exactement ce que lisait le mode unifié `step`.
    expect(slopeIn(keysOf(a), 1)).toBeCloseTo(0.015, 9);
  });
});

describe('tangents — unifier, briser, pondérer', () => {
  it('unifier aligne les deux côtés sur la moyenne des pentes libres', () => {
    let a = setTangentType(asymmetric(), middle, 'free');
    a = setTangentSlope(setBroken(a, middle, true), 'px', 1, 'out', 0.03);
    a = setTangentSlope(a, 'px', 1, 'in', 0.01);
    a = setBroken(a, middle, false);
    expect(key(a).tin).toBeCloseTo(0.02, 9);
    expect(key(a).tout).toBeCloseTo(0.02, 9);
    expect(isBroken(key(a))).toBe(false);
  });

  it('la pondération s’active à 1 (courbe inchangée) et se retire proprement', () => {
    const base = asymmetric();
    const a = setWeighted(base, middle, true);
    expect(isWeighted(key(a))).toBe(true);
    expect(key(a).wIn).toBe(1);
    expect(key(a).wOut).toBe(1);
    // Poids 1 = Hermite : la courbe ne bouge pas à l'activation.
    expect(evalChannel(a.channels.px, 500, 0)).toBeCloseTo(evalChannel(base.channels.px, 500, 0), 6);
    const off = setWeighted(a, middle, false);
    expect(isWeighted(key(off))).toBe(false);
  });

  it('longueur de poignée et poids se déduisent l’un de l’autre', () => {
    const a = setWeighted(asymmetric(), middle, true);
    const keys = keysOf(a);
    // Poids 1 : un tiers du segment voisin (1000 ms entrant, 1000 ms sortant).
    expect(handleSpanMs(keys, 1, 'in')).toBeCloseTo(1000 / 3, 6);
    expect(weightFromSpan(keys, 1, 'in', 500)).toBeCloseTo(1.5, 6);
    // Clé non pondérée : pas de longueur en temps (poignée à longueur d'écran fixe).
    expect(handleSpanMs(keysOf(asymmetric()), 1, 'in')).toBeNull();
    // Sans voisin, le poids n'a pas de sens.
    expect(weightFromSpan(keys, 2, 'out', 100)).toBeNull();
    expect(clampWeight(99)).toBe(1.5);
    expect(clampWeight(0)).toBe(0.05);
  });

  it('channelRefs désigne toutes les clés d’une courbe', () => {
    expect(channelRefs(asymmetric(), 'px')).toEqual([
      { channel: 'px', index: 0 },
      { channel: 'px', index: 1 },
      { channel: 'px', index: 2 },
    ]);
    expect(channelRefs(emptyAnim(), 'py')).toEqual([]);
  });
});
