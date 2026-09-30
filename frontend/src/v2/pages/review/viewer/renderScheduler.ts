// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';

/**
 * Rendu à la demande des viewers WebGL (modèle 3D et splat) — F14.
 *
 * Les deux viewers armaient `renderer.setAnimationLoop` au montage et rendaient à la cadence de
 * l'écran jusqu'au démontage, y compris sur une scène strictement immobile : soixante images
 * identiques par seconde, le ventilateur d'un portable pendant qu'on lit des commentaires.
 *
 * Le piège de ce correctif est l'image **figée** : une source de changement oubliée et le viewer
 * ne se rafraîchit plus, ce qui est bien pire que le ventilateur. Trois garde-fous, dans cet
 * ordre, chacun couvrant les manques du précédent :
 *
 * 1. **`update` tourne toujours.** Amortissement d'OrbitControls, `AnimationMixer` et abonnés de
 *    frame sont joués à chaque tour ; seules les passes GPU et les mesures de mise en page sont
 *    sautées. Rien de ce qui pilote la scène ne change donc de cadence, et la décision de rendre
 *    est prise **après** ces mises à jour : un déplacement de caméra fait par un abonné
 *    (turntable, animation caméra) est vu dans la frame même où il a lieu.
 * 2. **Sources d'invalidation larges.** `change` d'OrbitControls (orbite, zoom, pan, dolly,
 *    restauration de vue, fin d'amortissement), redimensionnement, et **toute entrée utilisateur
 *    de la fenêtre** — un réglage du HUD qui touche la scène (HDRI, plan de coupe, variante USD,
 *    mode d'affichage, masque splat, gizmo) est toujours précédé d'un clic, d'une touche ou d'un
 *    mouvement de pointeur. La fenêtre de `INPUT_WINDOW_MS` ouverte après chaque entrée couvre
 *    le délai entre le geste et l'effet React qui modifie la scène.
 * 3. **Battement de sécurité.** Même sans aucune invalidation, une image est rendue toutes les
 *    `IDLE_FRAME_INTERVAL_MS`. Une source oubliée — typiquement une arrivée asynchrone : HDRI
 *    chargée, variante cuite, modèle de comparaison, éditions splat persistées — coûte donc au
 *    pire ce délai, jamais un gel. C'est ce qui rend le correctif sûr par construction.
 */

/** Battement de sécurité au repos : une image toutes les 125 ms (8/s au lieu de ~60/s). */
export const IDLE_FRAME_INTERVAL_MS = 125;
/** Fenêtre de rendu plein régime ouverte après une entrée utilisateur. */
export const INPUT_WINDOW_MS = 300;
/** Fenêtre ouverte par une demande de miniature (la capture suit immédiatement un rendu). */
export const CAPTURE_WINDOW_MS = 500;
/** Fenêtre laissée à une scène qui vient d'arriver pour se stabiliser (décodage, LOD, tri). */
export const SETTLE_WINDOW_MS = 2000;

export interface RenderScheduler {
  /** Demande le rendu de la prochaine image, et de toutes celles des `windowMs` à venir. */
  invalidate: (windowMs?: number) => void;
  /** Vrai si cette image doit être rendue — enregistre l'instant du rendu quand elle l'est. */
  shouldRender: (nowMs: number) => boolean;
}

/** Émetteur `change` (OrbitControls) — typé au minimum pour rester testable sans WebGL. */
export interface ChangeEmitter {
  addEventListener: (type: 'change', listener: () => void) => void;
  removeEventListener: (type: 'change', listener: () => void) => void;
}

/** Hôte de boucle de rendu — `WebGLRenderer` en production, objet simple dans les tests. */
export interface AnimationLoopHost {
  setAnimationLoop: (cb: (() => void) | null) => void;
}

export interface RenderSchedulerOptions {
  /**
   * Vrai tant qu'un mouvement continu impose le plein régime : vol, clip d'animation en lecture,
   * abonné de frame (turntable, animation caméra, fondu A/B, rig caméra), capture en attente.
   */
  isBusy: () => boolean;
  idleIntervalMs?: number;
  /** Horloge injectable — les tests mesurent un nombre d'images, pas un temps réel. */
  now?: () => number;
}

export function createRenderScheduler(opts: RenderSchedulerOptions): RenderScheduler {
  const { isBusy } = opts;
  const idleIntervalMs = opts.idleIntervalMs ?? IDLE_FRAME_INTERVAL_MS;
  const clock = opts.now ?? (() => performance.now());
  let dirty = true; // la première image est toujours rendue
  let dirtyUntilMs = 0;
  let lastRenderMs: number | null = null;

  return {
    invalidate(windowMs = 0) {
      dirty = true;
      if (windowMs > 0) dirtyUntilMs = Math.max(dirtyUntilMs, clock() + windowMs);
    },
    shouldRender(nowMs) {
      const render =
        isBusy() ||
        dirty ||
        nowMs < dirtyUntilMs ||
        lastRenderMs === null ||
        nowMs - lastRenderMs >= idleIntervalMs;
      if (render) {
        dirty = false;
        lastRenderMs = nowMs;
      }
      return render;
    },
  };
}

/**
 * Entrées utilisateur écoutées au niveau de la fenêtre : un réglage du HUD qui modifie la scène
 * passe forcément par l'une d'elles. Écoute **passive et en capture** — aucun comportement de la
 * page n'est modifié, et aucun `preventDefault` n'est possible depuis ces écouteurs.
 */
const INPUT_EVENTS = [
  'pointerdown',
  'pointerup',
  'pointermove',
  'wheel',
  'keydown',
  'keyup',
  'input',
  'change',
  'touchstart',
  'touchmove',
] as const;

/** Ordonnanceur branché sur ses sources d'invalidation ambiantes. `detach` retire les écouteurs. */
export function armRenderScheduler(
  controls: ChangeEmitter,
  opts: RenderSchedulerOptions,
): RenderScheduler & { detach: () => void } {
  const scheduler = createRenderScheduler(opts);
  const onChange = () => scheduler.invalidate();
  const onInput = () => scheduler.invalidate(INPUT_WINDOW_MS);
  const listenerOpts = { capture: true, passive: true } as const;
  controls.addEventListener('change', onChange);
  for (const type of INPUT_EVENTS) window.addEventListener(type, onInput, listenerOpts);
  // Retour d'onglet : le navigateur a suspendu la boucle, l'image affichée peut dater.
  document.addEventListener('visibilitychange', onInput);
  return {
    ...scheduler,
    detach() {
      controls.removeEventListener('change', onChange);
      for (const type of INPUT_EVENTS) window.removeEventListener(type, onInput, listenerOpts);
      document.removeEventListener('visibilitychange', onInput);
    },
  };
}

export interface RenderLoopOptions {
  renderer: AnimationLoopHost;
  scheduler: RenderScheduler;
  /** Mises à jour de la scène — jouées à **chaque** tour, rendu ou non (cf. garde-fou 1). */
  update: (dt: number) => void;
  /** Passes GPU, mesures de mise en page, échantillonnage — seulement quand le rendu est dû. */
  draw: (nowMs: number) => void;
  now?: () => number;
}

/** Arme la boucle de rendu à la demande. Renvoie la fonction d'arrêt (démontage). */
export function startRenderLoop(opts: RenderLoopOptions): () => void {
  const { renderer, scheduler, update, draw } = opts;
  const clock = opts.now ?? (() => performance.now());
  let last = clock();
  renderer.setAnimationLoop(() => {
    const now = clock();
    const dt = (now - last) / 1000;
    last = now;
    update(dt);
    if (scheduler.shouldRender(now)) draw(now);
  });
  return () => renderer.setAnimationLoop(null);
}

export interface ViewerLoopOptions extends RenderSchedulerOptions {
  renderer: AnimationLoopHost;
  controls: ChangeEmitter;
  update: (dt: number) => void;
  draw: (nowMs: number) => void;
}

/**
 * Portail de rendu d'un viewer WebGL : tout ce que le hook du viewer doit tenir pour passer au
 * rendu à la demande — invalidation, abonnements passifs, comptage des lecteurs de FPS, boucle.
 */
export interface RenderGate {
  /** Demande un rendu — sans effet (et sans erreur) tant que la boucle n'est pas armée. */
  invalidate: (windowMs?: number) => void;
  /**
   * Abonnement **passif** à la boucle : joué à chaque tour comme les autres, mais sans imposer
   * le plein régime. `useModelAnimations` s'abonne en permanence pour relire `action.time` ;
   * sans cette distinction l'ensemble des abonnés ne serait jamais vide côté 3D et le rendu à
   * la demande ne s'enclencherait jamais. Un clip en lecture reste détecté par `isRunning()`.
   */
  subscribeIdle: (cb: (dt: number) => void) => () => void;
  /**
   * Compte les abonnés d'un échantillonneur de performance : tant qu'un panneau lit le FPS, le
   * viewer rend en continu — un compteur d'images par seconde qui abaisse la cadence qu'il
   * mesure ne mesure plus rien, et le chiffre lu par l'artiste ne serait comparable à rien.
   */
  countSub: (off: (() => void) | undefined) => (() => void) | undefined;
  /** Arme ordonnanceur + boucle. Renvoie l'arrêt (boucle, écouteurs, invalidation). */
  start: (opts: ViewerLoopOptions) => () => void;
}

export function createRenderGate(): RenderGate {
  const idleCbs = new Set<(dt: number) => void>();
  let statsSubs = 0;
  let invalidateFn: ((windowMs?: number) => void) | null = null;
  const invalidate = (windowMs?: number) => invalidateFn?.(windowMs);

  return {
    invalidate,
    subscribeIdle(cb) {
      idleCbs.add(cb);
      return () => idleCbs.delete(cb);
    },
    countSub(off) {
      if (!off) return undefined;
      statsSubs += 1;
      invalidate();
      return () => {
        statsSubs -= 1;
        off();
      };
    },
    start(opts) {
      const scheduler = armRenderScheduler(opts.controls, {
        isBusy: () => statsSubs > 0 || opts.isBusy(),
        idleIntervalMs: opts.idleIntervalMs,
        now: opts.now,
      });
      invalidateFn = scheduler.invalidate;
      const stop = startRenderLoop({
        renderer: opts.renderer,
        scheduler,
        // Les abonnés passifs relisent l'état **après** les mises à jour du viewer (le temps
        // d'animation n'a de sens qu'une fois `mixer.update` passé).
        update: (dt) => {
          opts.update(dt);
          for (const cb of idleCbs) cb(dt);
        },
        draw: opts.draw,
        now: opts.now,
      });
      return () => {
        invalidateFn = null;
        stop();
        scheduler.detach();
      };
    },
  };
}

/** Portail stable pour la durée de vie du composant (le recréer perdrait la boucle armée). */
export function useRenderGate(): RenderGate {
  const [gate] = useState(createRenderGate);
  return gate;
}
