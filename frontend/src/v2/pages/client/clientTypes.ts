// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { LightingConfig, SplatEdits, SplatPresentation } from '../review/reviewTypes';
import type { UsdVariantSet } from '../../types/usd';

/**
 * Réponse de `GET /api/client/:token/media/:id/url` telle que la page publique la consomme.
 *
 * La route ne sert aujourd'hui que `url` et `slateSec` : tout le reste décrit la **mise en
 * scène persistée** dont un média spatial a besoin pour être rejoué à l'identique chez
 * l'invité (GLB converti, présentation caméra, éclairage, éditions splat, override de
 * scène). Ces champs sont donc **optionnels** — les viewers se dégradent proprement quand la
 * route ne les envoie pas encore, et se remplissent d'eux-mêmes le jour où elle le fera.
 * Le détail exact de l'extension attendue est consigné dans le rapport de lot.
 */
export interface ClientMediaSource {
  /** Fichier servi : dérivé client (vidéo, slate en tête) ou source du média. */
  url: string;
  /** Durée du slate en tête du dérivé client (35.A) — décalage des timestamps. */
  slateSec?: number;
  /** GLB converti (`metadata.glbKey`) : indispensable dès que l'original n'est pas du glTF. */
  glbUrl?: string | null;
  /** Cadence du média — sans elle le lecteur invité ne sait pas compter les frames. */
  fps?: number | null;
  /** Première frame du projet (numérotation studio) — affichée par le transport. */
  startFrame?: number | null;
  /** « ReView override » de la scène 3D (46.D) : mise en scène rejouée pour tous. */
  usdOverride?: unknown;
  /** Chemins de prims de la scène USD — clé d'indexation de l'override. */
  usdPrimPaths?: string[] | null;
  /** Jeux de variantes actifs à la conversion — base de composition de l'override. */
  usdVariantSets?: UsdVariantSet[] | null;
  /** Éditions splat non destructives (transform, flip, volumes de crop). */
  splatEdits?: SplatEdits | null;
  /** Masque binaire de suppression (bitset) — URL présignée. */
  splatMaskUrl?: string | null;
  /** Ops binaires de transformation de sous-ensembles — URL présignée. */
  splatSubsetUrl?: string | null;
  /** Présentation persistée : caméra, aspect du cadre, DoF, LOD, éclairage. */
  splatPresentation?: SplatPresentation | null;
  /** Éclairage par défaut du projet (39.F), repli quand le média n'a pas le sien. */
  projectDefaultLighting?: LightingConfig | null;
  /** HDRI référencée par la présentation, déjà résolue en URL présignée pour l'invité. */
  hdri?: { url: string; format: 'hdr' | 'exr' } | null;
}
