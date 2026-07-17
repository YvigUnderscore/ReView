import { describe, expect, it } from 'vitest';
import type { SplatCamera, SplatCameraKeyframe } from '../../reviewTypes';
import {
  animDuration,
  animKeyTimes,
  animPlayDuration,
  deleteColumn,
  deleteKeys,
  emptyAnim,
  fromV1,
  hasAnimation,
  moveKey,
  moveKeysBatch,
  normalizeAnim,
  setAnimDuration,
  upsertKey,
  upsertPoseAt,
} from './model';
import { evalChannel, sampleAnimV2 } from './hermite';

const base: SplatCamera = { position: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 0, z: 0 } };
const pose = (x: number): SplatCamera => ({ position: { x, y: 0, z: 0 }, target: { x: 0, y: 0, z: 0 } });

describe('model — opérations pures', () => {
  it('upsertKey insère puis écrase au même temps, garde le tri', () => {
    let a = upsertKey(emptyAnim(), 'px', 1000, 5);
    a = upsertKey(a, 'px', 0, 1);
    a = upsertKey(a, 'px', 1000, 9); // écrase
    expect(a.channels.px?.keys.map((k) => [k.t, k.v])).toEqual([
      [0, 1],
      [1000, 9],
    ]);
  });

  it('animKeyTimes / animDuration / hasAnimation', () => {
    let a = upsertKey(emptyAnim(), 'px', 0, 0);
    a = upsertKey(a, 'py', 2000, 1);
    expect(animKeyTimes(a)).toEqual([0, 2000]);
    expect(animDuration(a)).toBe(2000);
    expect(hasAnimation(a)).toBe(true);
    expect(hasAnimation(upsertKey(emptyAnim(), 'px', 0, 0))).toBe(false); // une seule colonne
  });

  it('moveKey re-trie quand le temps dépasse la clé suivante', () => {
    let a = upsertPoseAt(emptyAnim(), 0, pose(0));
    a = upsertPoseAt(a, 1000, pose(10));
    a = moveKey(a, 'px', 0, { t: 2000 }); // dépasse l'autre clé
    expect(a.channels.px?.keys.map((k) => k.t)).toEqual([1000, 2000]);
  });

  it('deleteColumn retire les clés d’un temps sur tous les canaux', () => {
    let a = upsertPoseAt(emptyAnim(), 0, pose(0));
    a = upsertPoseAt(a, 1000, pose(10));
    a = deleteColumn(a, 1000);
    expect(animKeyTimes(a)).toEqual([0]);
  });

  it('moveKeysBatch déplace un lot multi-canaux depuis les index du baseline', () => {
    let a = upsertKey(emptyAnim(), 'px', 0, 0);
    a = upsertKey(a, 'px', 1000, 5);
    a = upsertKey(a, 'py', 1000, 3);
    // Décale de +500 ms les deux clés à 1000 (index 1 sur px, index 0 sur py).
    const b = moveKeysBatch(a, [
      { channel: 'px', index: 1, t: 1500, v: 5 },
      { channel: 'py', index: 0, t: 1500, v: 3 },
    ]);
    expect(b.channels.px?.keys.map((k) => k.t)).toEqual([0, 1500]);
    expect(b.channels.py?.keys.map((k) => k.t)).toEqual([1500]);
  });

  it('deleteKeys supprime un lot sans décaler les index restants', () => {
    let a = upsertKey(emptyAnim(), 'px', 0, 0);
    a = upsertKey(a, 'px', 1000, 5);
    a = upsertKey(a, 'px', 2000, 9);
    const b = deleteKeys(a, [
      { channel: 'px', index: 0 },
      { channel: 'px', index: 2 },
    ]);
    expect(b.channels.px?.keys.map((k) => [k.t, k.v])).toEqual([[1000, 5]]);
  });

  it('durée réglable : animPlayDuration prend l’override sinon le dernier temps', () => {
    let a = upsertKey(upsertKey(emptyAnim(), 'px', 0, 0), 'px', 1000, 10);
    expect(animPlayDuration(a)).toBe(1000);
    a = setAnimDuration(a, 3000);
    expect(animPlayDuration(a)).toBe(3000);
    a = setAnimDuration(a, 0); // retour automatique
    expect(a.durationMs).toBeUndefined();
    expect(animPlayDuration(a)).toBe(1000);
  });
});

describe('hermite — échantillonnage', () => {
  it('evalChannel borne aux extrémités', () => {
    const a = upsertKey(upsertKey(emptyAnim(), 'px', 0, 0), 'px', 1000, 10);
    expect(evalChannel(a.channels.px, -100, 0)).toBe(0);
    expect(evalChannel(a.channels.px, 1100, 0)).toBe(10);
  });

  it('mode linear = interpolation droite (milieu = moyenne)', () => {
    let a = upsertKey(emptyAnim(), 'px', 0, 0, 'linear');
    a = upsertKey(a, 'px', 1000, 10, 'linear');
    expect(evalChannel(a.channels.px, 500, 0)).toBeCloseTo(5);
  });

  it('mode step maintient la valeur de gauche', () => {
    let a = upsertKey(emptyAnim(), 'px', 0, 0, 'step');
    a = upsertKey(a, 'px', 1000, 10, 'step');
    expect(evalChannel(a.channels.px, 999, 0)).toBe(0);
    expect(evalChannel(a.channels.px, 1000, 0)).toBe(10);
  });

  it('mode auto passe exactement par les clés', () => {
    let a = upsertKey(emptyAnim(), 'px', 0, 0);
    a = upsertKey(a, 'px', 1000, 10);
    a = upsertKey(a, 'px', 2000, 0);
    expect(evalChannel(a.channels.px, 1000, 0)).toBeCloseTo(10);
    expect(evalChannel(a.channels.px, 0, 0)).toBeCloseTo(0);
  });

  it('canal absent → valeur de la pose de base', () => {
    const a = upsertKey(upsertKey(emptyAnim(), 'px', 0, 1), 'px', 1000, 2);
    const p = sampleAnimV2(a, 500, { ...base, target: { x: 7, y: 8, z: 9 } });
    expect(p.target).toEqual({ x: 7, y: 8, z: 9 }); // cible non animée = base
  });

  it('boucle : enroule le temps sur la durée', () => {
    let a = upsertKey(emptyAnim(true), 'px', 0, 0, 'linear');
    a = upsertKey(a, 'px', 1000, 10, 'linear');
    expect(sampleAnimV2(a, 1500, base).position.x).toBeCloseTo(5); // 1500 % 1000 = 500
  });
});

describe('fromV1 / normalizeAnim — migration', () => {
  const v1: SplatCameraKeyframe[] = [
    { t: 0, pose: pose(0), easing: 'linear' },
    { t: 1000, pose: pose(10), easing: 'ease-in-out' },
  ];

  it('fromV1 crée un canal par grandeur, migre l’easing en mode', () => {
    const a = fromV1(v1, true);
    expect(a.channels.px?.keys.map((k) => [k.t, k.v])).toEqual([
      [0, 0],
      [1000, 10],
    ]);
    expect(a.channels.px?.keys[0].mode).toBe('linear');
    expect(a.channels.px?.keys[1].mode).toBe('auto'); // ease-in-out → lissé
  });

  it('normalizeAnim accepte v1, v2, et rejette le vide', () => {
    expect(normalizeAnim({ keyframes: v1, loop: false })?.version).toBe(2);
    expect(normalizeAnim(fromV1(v1, true))?.version).toBe(2);
    expect(normalizeAnim(null)).toBeNull();
    expect(normalizeAnim({ keyframes: [v1[0]], loop: false })).toBeNull();
  });
});
