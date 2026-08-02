// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SplatCamera } from '../reviewTypes';

/**
 * Pose caméra à persister dans la présentation (Phase 17) — extrait de la vue capturée les seuls
 * champs enregistrés/rejoués : position, cible, focale, **aspect** (cadre de review fixe) et tilt.
 * Centralisé pour que 3D et splat enregistrent exactement les mêmes réglages (l'oubli de `aspect`
 * était la cause du cadre non persisté). Pur/testable.
 */
export function cameraPoseFromView(view: SplatCamera): SplatCamera {
  const pose: SplatCamera = { position: view.position, target: view.target };
  if (view.fov != null) pose.fov = view.fov;
  if (view.aspect != null) pose.aspect = view.aspect;
  if (view.roll != null) pose.roll = view.roll;
  return pose;
}
