// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
  createRenderGate,
  createRenderScheduler,
  IDLE_FRAME_INTERVAL_MS,
  INPUT_WINDOW_MS,
  startRenderLoop,
  type ChangeEmitter,
} from './renderScheduler';

/**
 * Rendu à la demande (F14). La grandeur mesurée ici est le **nombre d'images rendues** : on
 * pilote la boucle avec une horloge injectée et on compte les appels à `draw`. Le contraste
 * `isBusy: true` (comportement d'avant le correctif — une image par tour) / `isBusy: false`
 * (scène immobile) donne la mesure avant/après dans la même suite.
 */

const FRAME_MS = 1000 / 60;

/** Renderer minimal : mémorise la boucle armée et permet de la faire avancer tour par tour. */
function makeRenderer() {
  let loop: (() => void) | null = null;
  return {
    setAnimationLoop(cb: (() => void) | null) {
      loop = cb;
    },
    get armed() {
      return loop !== null;
    },
    tick() {
      loop?.();
    },
  };
}

/** OrbitControls minimal : n'expose que l'événement `change`. */
function makeControls() {
  const listeners = new Set<() => void>();
  const emitter: ChangeEmitter & { emitChange: () => void; count: () => number } = {
    addEventListener: (_type, listener) => void listeners.add(listener),
    removeEventListener: (_type, listener) => void listeners.delete(listener),
    emitChange: () => listeners.forEach((l) => l()),
    count: () => listeners.size,
  };
  return emitter;
}

/** Banc de mesure : 10 s de boucle à 60 Hz, compteurs de mises à jour et d'images rendues. */
function bench(isBusy: () => boolean, onUpdate?: () => void) {
  const clock = { t: 0 };
  const renderer = makeRenderer();
  const controls = makeControls();
  const gate = createRenderGate();
  const counts = { updates: 0, draws: 0 };
  const stop = gate.start({
    renderer,
    controls,
    isBusy,
    now: () => clock.t,
    update: () => {
      counts.updates += 1;
      onUpdate?.();
    },
    draw: () => {
      counts.draws += 1;
    },
  });
  const run = (frames: number) => {
    for (let i = 0; i < frames; i += 1) {
      clock.t += FRAME_MS;
      renderer.tick();
    }
  };
  return { clock, renderer, controls, gate, counts, stop, run };
}

describe('renderScheduler — rendu à la demande des viewers WebGL (F14)', () => {
  it('scène immobile : ~8 images rendues par seconde, alors que la boucle tourne toujours à 60', () => {
    const idle = bench(() => false);
    idle.run(600); // 10 s
    idle.stop();

    // Garde-fou 1 : rien de ce qui pilote la scène ne change de cadence.
    expect(idle.counts.updates).toBe(600);
    // Battement de sécurité : une image toutes les 125 ms, plus la toute première — mais le
    // battement ne peut tomber que sur une frontière d'image. À 60 Hz, sept images font 116,7 ms
    // (trop tôt) et huit en font 133,3 : l'intervalle réel est donc de HUIT images, pas de 7,5.
    // Compter en millisecondes surestimerait le nombre d'images rendues de 8 %.
    const imagesParBattement = Math.ceil(IDLE_FRAME_INTERVAL_MS / FRAME_MS);
    const attendu = 1 + Math.floor((600 - 1) / imagesParBattement);
    expect(idle.counts.draws).toBe(attendu);

    // Mesure « avant » : c'est exactement ce que faisait la boucle d'origine, sans condition.
    const avant = bench(() => true);
    avant.run(600);
    avant.stop();
    expect(avant.counts.draws).toBe(600);
    expect(idle.counts.draws * 7).toBeLessThan(avant.counts.draws);
  });

  it('une scène qui bouge rend chaque image (vol, clip, abonné de frame, capture)', () => {
    let bouge = true;
    const b = bench(() => bouge);
    b.run(60);
    expect(b.counts.draws).toBe(60);
    bouge = false; // le mouvement s'arrête : on retombe sur le battement
    b.run(60);
    b.stop();
    expect(b.counts.draws).toBeLessThan(60 + 12);
  });

  it("l'amortissement d'OrbitControls se prolonge de lui-même puis s'arrête", () => {
    // OrbitControls n'émet `change` que tant que la caméra bouge réellement : cinq pas
    // d'amortissement doivent donner cinq images, et rien de continu ensuite.
    let restant = 5;
    const b = bench(
      () => false,
      () => {
        if (restant > 0) {
          restant -= 1;
          b.controls.emitChange();
        }
      },
    );
    b.run(5);
    expect(b.counts.draws).toBe(5); // le `change` émis dans `update` est vu la frame même
    const apresAmortissement = b.counts.draws;
    b.run(5); // 83 ms : sous le battement, plus rien à dessiner
    b.stop();
    expect(b.counts.draws).toBe(apresAmortissement);
  });

  it('une entrée utilisateur de la fenêtre ouvre une fenêtre de rendu plein régime', () => {
    const b = bench(() => false);
    b.run(1); // consomme la première image
    const avant = b.counts.draws;
    window.dispatchEvent(new Event('pointerdown'));
    const frames = Math.floor(INPUT_WINDOW_MS / FRAME_MS) - 1;
    b.run(frames);
    b.stop();
    expect(b.counts.draws - avant).toBe(frames); // chaque image de la fenêtre est rendue
  });

  it("l'arrêt retire les écouteurs : plus aucune invalidation ambiante", () => {
    const b = bench(() => false);
    expect(b.controls.count()).toBe(1);
    b.run(1);
    b.stop();
    expect(b.controls.count()).toBe(0);
    expect(b.renderer.armed).toBe(false);
    // Une entrée après démontage ne doit plus rien réveiller.
    const avant = b.counts.draws;
    window.dispatchEvent(new Event('pointerdown'));
    b.run(5);
    expect(b.counts.draws).toBe(avant);
  });

  it('un abonné aux compteurs de performance impose le plein régime, et le rend en partant', () => {
    const b = bench(() => false);
    const off = b.gate.countSub(() => undefined);
    b.run(60);
    expect(b.counts.draws).toBe(60); // le FPS affiché reste celui du viewer, pas celui du repos
    off?.();
    const avant = b.counts.draws;
    b.run(60);
    b.stop();
    expect(b.counts.draws - avant).toBeLessThan(12);
  });

  it('countSub laisse passer un abonnement absent (échantillonneur pas encore monté)', () => {
    const gate = createRenderGate();
    expect(gate.countSub(undefined)).toBeUndefined();
  });

  it('les abonnés passifs sont joués à chaque tour sans imposer de rendu', () => {
    const b = bench(() => false);
    let passifs = 0;
    const off = b.gate.subscribeIdle(() => {
      passifs += 1;
    });
    b.run(60);
    expect(passifs).toBe(60); // la relecture du temps d'animation garde sa cadence
    expect(b.counts.draws).toBeLessThan(12); // mais elle ne force aucune image
    off();
    b.run(10);
    b.stop();
    expect(passifs).toBe(60);
  });

  it('invalidate() ne rend qu’une image ; invalidate(ms) rend toute la fenêtre', () => {
    const clock = { t: 0 };
    const scheduler = createRenderScheduler({ isBusy: () => false, now: () => clock.t });
    expect(scheduler.shouldRender(0)).toBe(true); // première image
    expect(scheduler.shouldRender(16)).toBe(false);
    scheduler.invalidate();
    expect(scheduler.shouldRender(32)).toBe(true);
    expect(scheduler.shouldRender(48)).toBe(false);
    clock.t = 48;
    scheduler.invalidate(100);
    expect(scheduler.shouldRender(64)).toBe(true);
    expect(scheduler.shouldRender(80)).toBe(true);
    expect(scheduler.shouldRender(96)).toBe(true);
    // Dernier rendu à 96, fenêtre close à 148 : à 160 la fenêtre est passée ET le battement
    // (96 + 125 = 221) n'est pas atteint — on ne rend donc pas.
    expect(scheduler.shouldRender(160)).toBe(false);
    expect(scheduler.shouldRender(221)).toBe(true); // battement atteint
    expect(scheduler.shouldRender(230)).toBe(false); // repartie pour 125 ms
  });

  it('startRenderLoop arrête bien la boucle', () => {
    const renderer = makeRenderer();
    const scheduler = createRenderScheduler({ isBusy: () => true });
    let draws = 0;
    const stop = startRenderLoop({
      renderer,
      scheduler,
      update: () => undefined,
      draw: () => {
        draws += 1;
      },
    });
    renderer.tick();
    expect(draws).toBe(1);
    stop();
    expect(renderer.armed).toBe(false);
  });
});
