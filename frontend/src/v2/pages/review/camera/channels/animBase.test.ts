// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { bakeToKeyframes, sampleAnimV2 } from './hermite';
import {
  animBase,
  emptyAnim,
  normalizeAnim,
  poseToBase,
  seedAnimBase,
  upsertKey,
  type CameraAnimBase,
  type CameraAnimV2,
} from './model';
import type { SplatCamera } from '../../reviewTypes';

/**
 * LA BASE DE POSE DE L'ANIMATION (Phase 50, lot 13).
 *
 * Un canal sans clé retombe sur une « base ». Ce repli était dynamique — la vue de celui qui
 * regarde — et deux échantillonneurs le prenaient à deux endroits : le lecteur keyframe sur une
 * pose capturée seulement dans certains parcours (l'origine du monde sinon), le rig de scène sur la
 * vue d'activation du mode layout. Une animation construite au gizmo ne clé que la position : sa
 * cible sautait donc à l'origine au premier scrub, alors qu'elle restait en place hors lecture.
 *
 * Le correctif fait voyager la base AVEC l'animation. Ce que ces cas verrouillent :
 *  - une animation neuve adopte sa base et échantillonne pareil quel que soit l'appelant ;
 *  - une animation héritée (des clés, pas de base) échantillonne EXACTEMENT comme avant.
 */

/** La vue depuis laquelle on construit : cible loin de l'origine, c'est tout l'enjeu. */
const view: SplatCamera = {
  position: { x: 9, y: 3, z: 4 },
  target: { x: 1, y: 0.5, z: -2 },
  fov: 50,
  aspect: 1.85,
};

/** Le repli qu'un appelant prête — volontairement différent de `view`. */
const other: CameraAnimBase = {
  position: { x: -100, y: -100, z: -100 },
  target: { x: -7, y: -8, z: -9 },
  fov: 90,
};

const ORIGIN: CameraAnimBase = { position: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 0, z: 0 } };

/** Animation « au gizmo » : seule la position est clée, la cible ne l'est jamais. */
const gizmoAnim = (): CameraAnimV2 =>
  upsertKey(upsertKey(seedAnimBase(emptyAnim(), view), 'px', 0, 0, 'linear'), 'px', 1_000, 10, 'linear');

/** La même, telle qu'elle était enregistrée avant la base (donnée héritée). */
const legacyAnim = (): CameraAnimV2 =>
  upsertKey(upsertKey(emptyAnim(), 'px', 0, 0, 'linear'), 'px', 1_000, 10, 'linear');

describe('poseToBase / seedAnimBase', () => {
  it('ne retient de la vue que les grandeurs échantillonnées', () => {
    const base = poseToBase(view);
    expect(base).toEqual({ position: view.position, target: view.target, fov: 50 });
    // Ni aspect ni tilt absent : la base n'est pas une deuxième présentation.
    expect('aspect' in base).toBe(false);
    expect('roll' in base).toBe(false);
  });

  it('garde le tilt quand la vue en porte un', () => {
    expect(poseToBase({ ...view, roll: 0.25 }).roll).toBe(0.25);
  });

  it('adopte la base d’une animation neuve', () => {
    expect(seedAnimBase(emptyAnim(), view).base).toEqual(poseToBase(view));
  });

  it('ne touche pas une animation qui porte déjà des clés (donnée héritée)', () => {
    const legacy = legacyAnim();
    // Identité : rien n'est réécrit, donc rien ne change de rejeu.
    expect(seedAnimBase(legacy, view)).toBe(legacy);
    expect(seedAnimBase(legacy, view).base).toBeUndefined();
  });

  it('ne réécrit pas une base déjà posée, et ne pose rien sans vue', () => {
    const seeded = seedAnimBase(emptyAnim(), view);
    expect(seedAnimBase(seeded, { ...view, target: { x: 99, y: 99, z: 99 } })).toBe(seeded);
    expect(seedAnimBase(emptyAnim(), undefined).base).toBeUndefined();
  });

  it('animBase arbitre : la base de l’animation, sinon le repli prêté', () => {
    expect(animBase(gizmoAnim(), other)).toEqual(poseToBase(view));
    expect(animBase(legacyAnim(), other)).toBe(other);
  });
});

describe('sampleAnimV2 — une seule base pour les deux échantillonneurs', () => {
  it('le canal non clé suit la base de l’animation, pas la vue de l’appelant', () => {
    const anim = gizmoAnim();
    // Le lecteur keyframe (dont la pose de repli n'avait jamais été capturée) et le rig de scène
    // (qui part de la vue d'activation) rendent désormais la même pose.
    const fromPlayer = sampleAnimV2(anim, 500, ORIGIN);
    const fromRig = sampleAnimV2(anim, 500, other);
    expect(fromPlayer).toEqual(fromRig);
    expect(fromPlayer.target).toEqual(view.target);
    expect(fromPlayer.position).toEqual({ x: 5, y: view.position.y, z: view.position.z });
    expect(fromPlayer.fov).toBe(50);
  });

  it('la cible ne retombe plus à l’origine du monde', () => {
    // Le défaut tel que l'utilisateur le décrivait : « si je me mets à 5 secondes, la caméra
    // revient à sa position originale ».
    expect(sampleAnimV2(gizmoAnim(), 5_000, ORIGIN).target).not.toEqual(ORIGIN.target);
  });

  it('une base sans focale ni tilt ne les invente pas', () => {
    const bare = seedAnimBase(emptyAnim(), { position: view.position, target: view.target });
    const anim = upsertKey(upsertKey(bare, 'px', 0, 0, 'linear'), 'px', 1_000, 10, 'linear');
    const pose = sampleAnimV2(anim, 500, other);
    expect(pose.fov).toBeUndefined();
    expect(pose.roll).toBeUndefined();
  });

  it('l’export glTF cuit la base de l’animation, pas la vue de celui qui exporte', () => {
    const baked = bakeToKeyframes(gizmoAnim(), ORIGIN, 4);
    for (const kf of baked) expect(kf.pose.target).toEqual(view.target);
  });
});

describe('sampleAnimV2 — animation héritée inchangée', () => {
  /**
   * Valeurs écrites à la main, telles que l'échantillonnage les rendait AVANT la base : canal clé
   * interpolé (0→10 en linéaire, donc 5 à mi-course), canaux non clés pris sur le repli prêté.
   * C'est la comparaison avant/après que réclame la migration à la lecture.
   */
  it('rend exactement les valeurs d’avant : canaux non clés = repli prêté', () => {
    const legacy = legacyAnim();
    expect(legacy.base).toBeUndefined();
    expect(sampleAnimV2(legacy, 500, other)).toEqual({
      position: { x: 5, y: other.position.y, z: other.position.z },
      target: other.target,
      fov: other.fov,
    });
    expect(sampleAnimV2(legacy, 0, ORIGIN)).toEqual({
      position: { x: 0, y: 0, z: 0 },
      target: { x: 0, y: 0, z: 0 },
    });
  });

  it('suit le repli de chaque appelant, divergence comprise — comportement d’alors', () => {
    const legacy = legacyAnim();
    expect(sampleAnimV2(legacy, 500, ORIGIN).target).toEqual(ORIGIN.target);
    expect(sampleAnimV2(legacy, 500, other).target).toEqual(other.target);
  });
});

describe('normalizeAnim — la base traverse la lecture', () => {
  it('rend l’animation telle quelle, base comprise et sans recopie', () => {
    const anim = gizmoAnim();
    const read = normalizeAnim(JSON.parse(JSON.stringify(anim)));
    expect(read?.base).toEqual(poseToBase(view));
    // Identité préservée pour une animation saine : des effets en dépendent.
    expect(normalizeAnim(anim)).toBe(anim);
  });

  it('retire une base illisible au lieu de faire tomber l’échantillonnage', () => {
    const forged: unknown = { ...legacyAnim(), base: { position: 'nope', target: null } };
    const read = normalizeAnim(forged);
    expect(read).not.toBeNull();
    expect(read?.base).toBeUndefined();
    // Et l'échantillonnage reprend le repli prêté, sans lever.
    expect(sampleAnimV2(read as CameraAnimV2, 500, other).target).toEqual(other.target);
  });
});
