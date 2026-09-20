// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFlyControls, FLY_MOVE_MAPPING, isFlyMoveCode, moveDirection } from './flyControls';
import { orbitInhibitors, inhibitOrbit } from './controlsLock';

describe('moveDirection', () => {
  it('mappe les codes physiques ZQSD/WASD + A/E (monter/descendre)', () => {
    expect(moveDirection(new Set(['KeyW']))).toEqual([0, 0, -1]);
    expect(moveDirection(new Set(['KeyS']))).toEqual([0, 0, 1]);
    expect(moveDirection(new Set(['KeyA']))).toEqual([-1, 0, 0]);
    expect(moveDirection(new Set(['KeyD']))).toEqual([1, 0, 0]);
    expect(moveDirection(new Set(['KeyE']))).toEqual([0, 1, 0]); // monter
    expect(moveDirection(new Set(['KeyQ']))).toEqual([0, -1, 0]); // descendre
  });

  it('normalise les diagonales et annule les directions opposées', () => {
    const [x, , z] = moveDirection(new Set(['KeyW', 'KeyD']));
    expect(Math.hypot(x, z)).toBeCloseTo(1);
    expect(x).toBeCloseTo(Math.SQRT1_2);
    expect(z).toBeCloseTo(-Math.SQRT1_2);
    expect(moveDirection(new Set(['KeyW', 'KeyS']))).toEqual([0, 0, 0]);
  });

  it('ignore les codes hors mapping', () => {
    expect(moveDirection(new Set(['KeyX', 'Space']))).toEqual([0, 0, 0]);
    expect(Object.keys(FLY_MOVE_MAPPING)).toHaveLength(6);
  });
});

/**
 * Three minimal : le vol n'utilise que trois vecteurs et un Euler. La caméra ne tourne pas dans
 * ces tests (`applyQuaternion` est l'identité), ce qui suffit — on mesure qui bouge et quand,
 * pas dans quelle direction (`moveDirection` s'en charge, juste au-dessus).
 */
class V3 {
  constructor(
    public x = 0,
    public y = 0,
    public z = 0,
  ) {}
  set(x: number, y: number, z: number) {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }
  copy(v: V3) {
    return this.set(v.x, v.y, v.z);
  }
  applyQuaternion() {
    return this;
  }
  addScaledVector(v: V3, s: number) {
    return this.set(this.x + v.x * s, this.y + v.y * s, this.z + v.z * s);
  }
  distanceTo(v: V3) {
    return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z);
  }
}

const THREE = {
  MOUSE: { PAN: 2 },
  Vector3: V3,
  Euler: class {
    x = 0;
    y = 0;
    z = 0;
    setFromQuaternion() {
      return this;
    }
  },
} as unknown as typeof import('three');

function setup() {
  const dom = document.createElement('div');
  document.body.appendChild(dom);
  const camera = { position: new V3(0, 0, 5), quaternion: { setFromEuler: vi.fn() } };
  const controls = { enabled: true, target: new V3(), mouseButtons: {}, update: vi.fn() };
  const fly = createFlyControls(
    THREE,
    camera as unknown as Parameters<typeof createFlyControls>[1],
    controls as unknown as Parameters<typeof createFlyControls>[2],
    dom,
  );
  return { dom, camera, controls, fly };
}

/** Appui du bouton droit sur le canvas : le vol commence. */
const takeOff = (dom: HTMLElement) =>
  dom.dispatchEvent(new PointerEvent('pointerdown', { button: 2, bubbles: true, cancelable: true }));
const land = (dom: HTMLElement) =>
  dom.dispatchEvent(new PointerEvent('pointerup', { button: 2, bubbles: true }));
const press = (code: string, target: EventTarget = window) =>
  target.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true }));

afterEach(() => {
  document.body.innerHTML = '';
});

describe('le clavier appartient au vol, et seulement au vol', () => {
  it('ignore une touche enfoncée AVANT le vol : on ne décolle jamais déjà en mouvement', () => {
    const { dom, camera, fly } = setup();
    press('KeyW'); // maintenue hors vol : rien ne bouge, et rien ne doit s'accumuler
    takeOff(dom);
    fly.update(1);
    expect(camera.position.z).toBe(5);
    fly.dispose();
  });

  it('avance quand la touche est pressée PENDANT le vol', () => {
    const { dom, camera, fly } = setup();
    takeOff(dom);
    press('KeyW');
    fly.update(1);
    expect(camera.position.z).toBeLessThan(5);
    fly.dispose();
  });

  it('ignore une touche frappée dans un champ de saisie, même en vol', () => {
    const { dom, camera, fly } = setup();
    const field = document.createElement('textarea');
    document.body.appendChild(field);
    takeOff(dom);
    press('KeyW', field);
    fly.update(1);
    expect(camera.position.z).toBe(5);
    fly.dispose();
  });

  it('nomme les touches du vol en un seul endroit', () => {
    expect(isFlyMoveCode('KeyS')).toBe(true);
    expect(isFlyMoveCode('KeyX')).toBe(false);
    expect(Object.keys(FLY_MOVE_MAPPING).every(isFlyMoveCode)).toBe(true);
  });
});

describe('l’orbite est retenue par un compteur, pas par un booléen', () => {
  it('gèle l’orbite au décollage et la rend à l’atterrissage', () => {
    const { dom, controls, fly } = setup();
    takeOff(dom);
    expect(controls.enabled).toBe(false);
    expect(orbitInhibitors(controls)).toEqual(['fly']);
    land(dom);
    expect(controls.enabled).toBe(true);
    fly.dispose();
  });

  it('ne rend pas l’orbite quand un gizmo relâche le sien EN PLEIN VOL', () => {
    const { dom, controls, fly } = setup();
    takeOff(dom);
    const gizmo = inhibitOrbit(controls, 'gizmo-drag');
    gizmo();
    expect(controls.enabled).toBe(false); // le défaut d'origine rendait l'orbite ici
    land(dom);
    expect(controls.enabled).toBe(true);
    fly.dispose();
  });

  it('rend son jeton au `dispose`, vol en cours', () => {
    const { dom, controls, fly } = setup();
    takeOff(dom);
    fly.dispose();
    expect(controls.enabled).toBe(true);
    expect(orbitInhibitors(controls)).toEqual([]);
  });
});
