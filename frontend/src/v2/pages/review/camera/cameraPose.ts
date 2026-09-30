// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SplatCamera } from '../reviewTypes';

/**
 * Pose caméra à persister dans la présentation (Phase 17) — extrait de la vue capturée les seuls
 * champs enregistrés/rejoués : position, cible, focale et tilt. Centralisé pour que 3D et splat
 * enregistrent exactement les mêmes réglages. Pur/testable.
 *
 * L'ASPECT N'EST PAS CAPTURÉ. Le ratio du cadre de review appartient aux réglages pipeline
 * (résolution héritée studio → projet → séquence → plan) ; la caméra ne fait que le porter. Le
 * recopier depuis la vue fermait la boucle : `camera.aspect` valait le ratio du cadre, le
 * cadre lisait la présentation, et le premier enregistrement de mise en scène gelait un 16/9
 * que personne n'avait choisi (cf. `reviewAspect.ts`).
 *
 * Un aspect DÉJÀ enregistré est en revanche reconduit tel quel (`storedAspect`) : le guide
 * letterbox ancre les annotations 2D normalisées, et le laisser tomber à l'enregistrement
 * suivant déplacerait à l'écran des annotations posées sur des reviews déjà validées.
 */
export function cameraPoseFromView(view: SplatCamera, storedAspect?: number | null): SplatCamera {
  const pose: SplatCamera = { position: view.position, target: view.target };
  if (view.fov != null) pose.fov = view.fov;
  if (typeof storedAspect === 'number' && Number.isFinite(storedAspect) && storedAspect > 0)
    pose.aspect = storedAspect;
  if (view.roll != null) pose.roll = view.roll;
  return pose;
}
