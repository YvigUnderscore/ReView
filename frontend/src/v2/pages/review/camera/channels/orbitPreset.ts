// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SplatCamera } from '../../reviewTypes';
import { emptyAnim, upsertFullKey, upsertKey, type CameraAnimV2 } from './model';

/**
 * Preset « Orbite » — un tour complet autour de la cible courante, réécrit sur la mécanique de
 * l'**auto-rotation** (`three/turntable.ts`) : le vecteur caméra→cible tourne autour de l'axe Y
 * du monde, ce qui conserve exactement la distance à la cible et la hauteur de la caméra. Seule
 * différence avec le turntable, qui bouge la vue frame par frame : ici le tour est **écrit en
 * clés**, donc persisté et rejoué à l'identique pour tous.
 *
 * Trois défauts corrigés (Phase 50, lot 7) :
 *  1. les tangentes `auto` (Catmull-Rom sur 9 points d'un cosinus) faisaient un rayon variable de
 *     4,9 % et une vitesse variable de 16 % — ce n'était pas un cercle. Chaque clé porte désormais
 *     la **tangente exacte** du cercle (mode `free`), et 8 segments suffisent : rayon constant à
 *     0,1 %, vitesse à 0,08 % ;
 *  2. la dernière clé retombait sur une tangente tronquée, d'où une cassure de direction de 45° à
 *     chaque bouclage. La tangente à `t = durée` est celle de `t = 0` (l'angle diffère de 2π) :
 *     la boucle est continue par construction ;
 *  3. les cinq canaux constants (hauteur, cible, focale) écrivaient 45 clés qui n'apportaient
 *     rien et encombraient le curve editor et l'historique. Une clé unique par canal constant
 *     suffit — `evalChannel` rend la valeur d'une clé seule à tout instant. 23 clés au lieu de 63.
 *
 * Les canaux constants sont **écrits** plutôt que laissés vides : un canal sans clé retombe sur la
 * pose de base, qui n'est pas persistée — l'orbite ne se rejouerait pas à l'identique.
 */

/** Durée d'un tour complet (ms). Doit rester divisible par `ORBIT_STEPS` : arrondir les temps de
 *  clé suffit à faire réapparaître une vitesse variable (mesuré à 0,45 % pour 36 pas). */
export const ORBIT_DURATION_MS = 12000;

/** Segments du tour. 8 avec les tangentes exactes valent mieux que 36 en `auto`. */
const ORBIT_STEPS = 8;

/** Élévation de repli quand la vue est à la verticale de la cible (rad). */
const FALLBACK_ELEVATION = Math.PI / 6;

/** En deçà de cette fraction de la distance, l'écart horizontal est jugé dégénéré. */
const MIN_HORIZONTAL = 0.1;

/** Géométrie du tour déduite de la vue de départ. */
export interface OrbitStart {
  /** Centre du tour = cible de la vue. */
  center: { x: number; y: number; z: number };
  /** Rayon dans le plan XZ (unités monde). */
  radius: number;
  /** Hauteur de la caméra au-dessus du centre — conservée pendant tout le tour. */
  height: number;
  /** Angle de départ dans le plan XZ (rad). */
  angle: number;
}

/**
 * Déduit la géométrie du tour de la vue courante. Le cas général reprend le turntable : rayon =
 * écart horizontal, hauteur = écart vertical, donc **distance à la cible inchangée**.
 *
 * Depuis une vue plongeante verticale, l'écart horizontal est quasi nul : l'ancien `|| 1` ramenait
 * le rayon à 1 unité monde et l'orbite changeait complètement d'échelle. On bascule désormais à
 * une élévation de 30° **en gardant la distance** — c'est l'échelle qui comptait, pas l'angle.
 * Pur/testable.
 */
export function orbitStartFromView(from: SplatCamera): OrbitStart {
  const center = { x: from.target.x, y: from.target.y, z: from.target.z };
  const dx = from.position.x - center.x;
  const dy = from.position.y - center.y;
  const dz = from.position.z - center.z;
  // Caméra exactement sur sa cible : aucune distance à conserver, on en prend une.
  const distance = Math.hypot(dx, dy, dz) || 1;
  const horizontal = Math.hypot(dx, dz);
  const angle = horizontal > 0 ? Math.atan2(dz, dx) : 0;
  if (horizontal >= distance * MIN_HORIZONTAL) return { center, radius: horizontal, height: dy, angle };
  return {
    center,
    radius: distance * Math.cos(FALLBACK_ELEVATION),
    height: Math.sign(dy || 1) * distance * Math.sin(FALLBACK_ELEVATION),
    angle,
  };
}

/** Un tour complet autour de la cible de `from`, en boucle. */
export function orbitPresetV2(from: SplatCamera): CameraAnimV2 {
  const { center, radius, height, angle } = orbitStartFromView(from);
  // Vitesse angulaire constante (rad/ms) — c'est elle qui donne les tangentes exactes, exprimées
  // en unités/ms comme le veut `hermite.ts`.
  const omega = (2 * Math.PI) / ORBIT_DURATION_MS;
  let anim = emptyAnim(true);
  for (let i = 0; i <= ORBIT_STEPS; i++) {
    const a = angle + (i / ORBIT_STEPS) * 2 * Math.PI;
    const t = Math.round((i * ORBIT_DURATION_MS) / ORBIT_STEPS);
    const dxdt = -Math.sin(a) * radius * omega;
    const dzdt = Math.cos(a) * radius * omega;
    anim = upsertFullKey(anim, 'px', {
      t,
      v: center.x + Math.cos(a) * radius,
      tin: dxdt,
      tout: dxdt,
      mode: 'free',
    });
    anim = upsertFullKey(anim, 'pz', {
      t,
      v: center.z + Math.sin(a) * radius,
      tin: dzdt,
      tout: dzdt,
      mode: 'free',
    });
  }
  // Canaux constants : une seule clé, au début du tour.
  anim = upsertKey(anim, 'py', 0, center.y + height);
  anim = upsertKey(anim, 'tx', 0, center.x);
  anim = upsertKey(anim, 'ty', 0, center.y);
  anim = upsertKey(anim, 'tz', 0, center.z);
  if (from.fov != null) anim = upsertKey(anim, 'fov', 0, from.fov);
  if (from.roll != null) anim = upsertKey(anim, 'roll', 0, from.roll);
  return anim;
}
