// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useCameraAnim, type CameraAnimState, type CameraController } from './useCameraAnim';
import { sampleAnimV2 } from './channels/hermite';
import { emptyAnim, poseToBase, upsertKey, type CameraAnimV2 } from './channels/model';
import type { SplatCamera } from '../reviewTypes';

/**
 * LA BASE DE POSE, VUE DU HOOK (Phase 50, lot 13).
 *
 * Le lecteur keyframe et le rig de scène échantillonnaient la même animation avec DEUX bases : le
 * hook partait d'une pose à l'origine du monde tant qu'aucun parcours ne l'avait capturée, le rig de
 * la vue d'activation du mode layout. Une animation construite AU GIZMO ne passe par aucun de ces
 * parcours : sa cible, non clée, sautait à l'origine au premier scrub — « si je me mets à 5
 * secondes, la caméra revient à sa position originale ».
 *
 * Ces cas montent le hook avec le contrôleur que le mode layout lui prête et vérifient que la base
 * voyage avec l'animation neuve, sans rien changer pour une animation héritée.
 */

/** La pose du plan que `captureCamera` rend (celle du PiP hors caméra). */
const shot: SplatCamera = {
  position: { x: 9, y: 3, z: 4 },
  target: { x: 1, y: 0.5, z: -2 },
  fov: 50,
};

/** Le repli que le rig de scène prête de son côté (vue d'activation). */
const rigFallback = shot;

/**
 * Monte le hook sur le contrôleur du mode layout, au plus près du vrai : la capture rend la
 * **dernière pose appliquée** à la caméra du plan (`useLayoutMode.captureShot` la lit dans
 * `shotPoseRef`, qu'écrit `applyShot`), sinon la vue d'activation. C'est ce chaînage qui rend
 * l'ordre du geste de gizmo piégeux — il scrube avant d'écrire, et le scrub d'une animation sans
 * base applique l'origine du monde, que la capture rendrait ensuite comme « vue courante ».
 */
function harness() {
  const capture = { current: shot as SplatCamera | undefined };
  const restored: SplatCamera[] = [];
  const controller: CameraController = {
    subscribeFrame: () => () => {},
    restoreCamera: (state) => {
      restored.push(state as SplatCamera);
    },
    captureCamera: () => restored[restored.length - 1] ?? capture.current,
    getDom: () => null,
  };
  const { result } = renderHook(() => useCameraAnim(controller));
  return { result, capture, restored, last: () => restored[restored.length - 1] };
}

/** Rejoue un geste de gizmo : ouverture du geste, puis écriture des canaux de position. */
function gizmoDrag(result: { current: CameraAnimState }) {
  act(() => result.current.beginStroke());
  act(() => result.current.strokeUpsertAt(0, { px: 0, py: 3, pz: 4 }));
  act(() => result.current.strokeUpsertAt(1_000, { px: 10, py: 3, pz: 4 }));
}

describe('useCameraAnim — base d’une animation neuve', () => {
  it('un geste de gizmo fait adopter la vue courante comme base', () => {
    const { result } = harness();
    gizmoDrag(result);
    expect(result.current.anim.base).toEqual(poseToBase(shot));
    expect(result.current.hasAnimation).toBe(true);
  });

  it('la cible non clée ne saute plus à l’origine au scrub', () => {
    const { result, last } = harness();
    gizmoDrag(result);
    act(() => result.current.scrub(5_000));
    // Le défaut : la pose appliquée à la caméra regardait l'origine du monde.
    expect(last().target).toEqual(shot.target);
  });

  it('lecture et hors-lecture rendent la même pose', () => {
    const { result, last } = harness();
    gizmoDrag(result);
    act(() => result.current.scrub(500));
    // Hors lecture, c'est le rig de scène qui échantillonne, avec son propre repli.
    expect(last()).toEqual(sampleAnimV2(result.current.anim, 500, rigFallback));
    // Et même avec un repli quelconque : la base de l'animation l'emporte.
    expect(last()).toEqual(
      sampleAnimV2(result.current.anim, 500, {
        position: { x: -50, y: -50, z: -50 },
        target: { x: -50, y: -50, z: -50 },
      }),
    );
  });

  it('le geste scrube avant d’écrire : la base ne prend pas la pose déjà appliquée', () => {
    const { result } = harness();
    // L'ordre réel du rig de scène : ouvrir le geste, amener la tête de lecture au temps où il
    // écrira, puis écrire. Le scrub d'une animation encore vide applique le repli — si la base
    // n'était adoptée qu'à l'écriture, elle prendrait cette pose-là au lieu de la vue du plan.
    act(() => result.current.beginStroke());
    act(() => result.current.scrub(250));
    act(() => result.current.strokeUpsertAt(250, { px: 0, py: 3, pz: 4 }));
    expect(result.current.anim.base).toEqual(poseToBase(shot));
  });

  it('poser une clé à la vue adopte aussi la base', () => {
    const { result } = harness();
    act(() => result.current.insertKeyAtView(0));
    expect(result.current.anim.base).toEqual(poseToBase(shot));
  });

  it('une clé posée sur un seul canal adopte aussi la base', () => {
    const { result } = harness();
    act(() => result.current.addKey('px', 0, 1));
    expect(result.current.anim.base).toEqual(poseToBase(shot));
  });

  it('une clé de focale sur un canal vide part de la base, pas de zéro', () => {
    const { result, capture } = harness();
    // Une clé sur le seul canal `px` : l'animation adopte la base, et `fov` reste VIDE.
    act(() => result.current.addKey('px', 0, 1));
    // La capture cesse ensuite de porter la focale : la valeur ne peut plus venir que du canal,
    // vide, donc de la base. Le repli valait 0 — une caméra à 0° de champ.
    capture.current = { position: shot.position, target: shot.target };
    act(() => result.current.insertChannelKeyAtView('fov', 500));
    expect(result.current.anim.channels.fov?.keys[0]?.v).toBe(50);
  });

  it('sans vue capturable, aucune base n’est inventée', () => {
    const { result, capture } = harness();
    capture.current = undefined;
    gizmoDrag(result);
    expect(result.current.anim.base).toBeUndefined();
  });
});

describe('useCameraAnim — animation héritée', () => {
  /** Une animation telle qu'elle était enregistrée avant la base : des clés, pas de base. */
  const legacy = (): CameraAnimV2 =>
    upsertKey(upsertKey(emptyAnim(), 'px', 0, 0, 'linear'), 'px', 1_000, 10, 'linear');

  it('reste sans base, même après un geste de gizmo', () => {
    const { result } = harness();
    act(() => result.current.setAnim(legacy()));
    expect(result.current.anim.base).toBeUndefined();
    gizmoDrag(result);
    // Lui en donner une changerait le rejeu d'une présentation déjà enregistrée : exclu.
    expect(result.current.anim.base).toBeUndefined();
  });

  it('échantillonne exactement les valeurs d’avant', () => {
    const { result, last } = harness();
    act(() => result.current.setAnim(legacy()));
    act(() => result.current.scrub(500));
    // Valeurs écrites à la main : canal clé interpolé (0→10 en linéaire), canaux non clés pris sur
    // la pose capturée par `setAnim` — ce que le hook faisait déjà.
    expect(last()).toEqual({
      position: { x: 5, y: shot.position.y, z: shot.position.z },
      target: shot.target,
      fov: 50,
    });
  });
});
