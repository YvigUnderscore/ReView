// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ClientComment, ReviewComment } from '../../types/api';
import type { UsdVariantSet } from '../../types/usd';
import { DEFAULT_LIGHTING, type LightingConfig } from '../review/reviewTypes';
import type { VariantSelection } from '../review/three/sceneOverrideApply';
import type { ClientMediaSource } from './clientTypes';

/**
 * Traduction du payload de partage vers ce qu'attendent les viewers internes réutilisés.
 * Tout est pur : le partage n'a le droit à aucune requête authentifiée, ces fonctions sont
 * donc le seul endroit où l'on décide ce qui est affichable avec ce que la route donne.
 */

/** Extensions que Spark sait ouvrir — `.sogs` est normalisé en `.sog` par le viewer. */
const SPLAT_EXT = /\.(ply|spz|splat|ksplat|sog|sogs)(\?|$)/i;
const GLTF_EXT = /\.(glb|gltf)(\?|$)/i;

/**
 * GLB affichable pour un invité : le dérivé converti quand la route l'expose, sinon le
 * fichier source s'il est déjà du glTF. `null` = rien à charger — le pane affiche son état
 * « modèle inaffichable » plutôt qu'un canvas noir.
 */
export function resolveClientGlb(source: ClientMediaSource | undefined): string | null {
  if (!source) return null;
  if (source.glbUrl) return source.glbUrl;
  return GLTF_EXT.test(source.url) ? source.url : null;
}

/**
 * Fichier splat affichable : Spark déduit le décodeur de l'extension, qui vit sur le nom
 * d'origine du média et non sur l'URL présignée (laquelle porte une query de signature).
 */
export function resolveClientSplat(
  source: ClientMediaSource | undefined,
  originalName: string,
): { url: string; fileName: string } | null {
  if (!source) return null;
  const named = SPLAT_EXT.test(originalName);
  if (!named && !SPLAT_EXT.test(source.url)) return null;
  return { url: source.url, fileName: named ? originalName : source.url.replace(/\?.*$/, '') };
}

/**
 * Aspect du cadre de livraison rejoué chez l'invité : celui de la caméra de présentation,
 * sinon `undefined` (le pane retombe sur son défaut 16:9). Un aspect aberrant est ignoré —
 * une présentation ancienne ne doit pas produire un cadre de hauteur nulle.
 */
export function clientFrameAspect(source: ClientMediaSource | undefined): number | undefined {
  const aspect = source?.splatPresentation?.camera?.aspect;
  return typeof aspect === 'number' && Number.isFinite(aspect) && aspect > 0 ? aspect : undefined;
}

/**
 * Éclairage rejoué : réglage propre au média, sinon défaut du projet, sinon neutre — même
 * cascade que la review interne (39.F), fusionnée sur `DEFAULT_LIGHTING` pour tolérer les
 * enregistrements antérieurs à un champ.
 */
export function clientLighting(source: ClientMediaSource | undefined): LightingConfig {
  const own = source?.splatPresentation?.lighting;
  const project = source?.projectDefaultLighting;
  return { ...DEFAULT_LIGHTING, ...(own ?? project ?? {}) };
}

/** Options de variantes actives à la conversion, indexées par prim (base de l'override). */
export function clientVariantDefaults(sets: UsdVariantSet[] | null | undefined): VariantSelection {
  const defaults: VariantSelection = {};
  for (const set of sets ?? [])
    defaults[set.prim] = { ...(defaults[set.prim] ?? {}), [set.name]: set.selected };
  return defaults;
}

/**
 * Position dans le **média** à partir de la position dans le lecteur. Le dérivé client porte
 * un slate en tête (35.A) que la review interne ne connaît pas : sans ce retrait, chaque
 * commentaire d'invité serait décalé de la durée du slate.
 */
export function mediaTimeOf(playerTime: number, slateSec: number): number {
  return Math.max(0, playerTime - slateSec);
}

/** Réciproque : où se placer dans le lecteur pour atteindre une position du média. */
export function playerTimeOf(mediaTime: number, slateSec: number): number {
  return Math.max(0, mediaTime + slateSec);
}

/**
 * Commentaires du partage vus par la timeline interne, qui raisonne en **temps lecteur** :
 * les timestamps sont donc décalés du slate. Les champs que le partage n'expose pas
 * (réactions, fils, états) restent vides — la timeline ne s'en sert que pour l'affichage.
 */
export function toPlayerComments(comments: readonly ClientComment[], slateSec: number): ReviewComment[] {
  return comments.map((c) => ({
    id: c.id,
    content: c.content,
    timestamp: c.timestamp == null ? null : playerTimeOf(c.timestamp, slateSec),
    createdAt: c.createdAt,
    author: c.author ? { id: c.author.id, name: c.author.name } : null,
    guestName: c.guestName,
    cameraState: null,
    annotation: null,
    isEdited: false,
    isResolved: false,
  }));
}
