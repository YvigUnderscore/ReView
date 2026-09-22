// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Ancrage d'un calque React sur les pastilles d'un viewer spatial.
 *
 * Les pastilles numérotées des points d'intérêt sont posées et **repositionnées à chaque image
 * dessinée** par du code impératif (`three/objectHotspot`), dans le conteneur du viewer. Un
 * calque React qui voudrait suivre les points devrait se reprojeter avec elles — et les deux
 * viewers rendent **à la demande** (`viewer/renderScheduler`) : un calque qui mesure en boucle
 * tiendrait le viewer éveillé en permanence, ventilateur compris.
 *
 * D'où ce contrat : le calque ne projette RIEN. Il s'ancre **dans** la pastille par un portail et
 * hérite de sa transformation — donc de la projection déjà faite, gratuitement, et de son
 * escamotage quand le point passe derrière la caméra. Le conteneur du viewer est la seule surface
 * que les deux côtés connaissent déjà (`containerRef` pour React, `container` pour le marqueur) :
 * l'annonce passe par lui, et rien d'autre ne les relie.
 */

/** Attribut d'une pastille : son rang, seule chose dont le calque a besoin pour s'y ancrer. */
export const POI_ANCHOR_ATTR = 'data-poi-anchor';

/** Annonce faite sur le conteneur quand l'ensemble des pastilles change (pose, démontage). */
export const POI_ANCHORS_EVENT = 'review:poi-anchors';

/** Attribut d'une carte ancrée — l'autre bout du contrat : voir `isPoiCardGesture`. */
export const POI_CARD_ATTR = 'data-poi-card';

/**
 * Le geste a atterri sur une carte ancrée dans la scène : on LIT un commentaire, on ne navigue
 * pas. La zone de review masque le dessin 2D au premier geste de navigation (il n'a de sens que
 * depuis la caméra d'origine) — déplier une carte ou faire défiler son texte n'en est pas un.
 */
export function isPoiCardGesture(target: unknown): boolean {
  return target instanceof Element && target.closest(`[${POI_CARD_ATTR}]`) !== null;
}

/** Rang porté par une pastille (`-1` si l'attribut manque — elle passera en queue de liste). */
const rankOf = (el: Element): number => Number(el.getAttribute(POI_ANCHOR_ATTR) ?? -1);

/** Pastilles présentes dans le conteneur, rangées par leur rang (l'index = le rang du point). */
export function poiAnchors(container: HTMLElement | null): HTMLElement[] {
  if (!container) return [];
  return Array.from(container.querySelectorAll<HTMLElement>(`[${POI_ANCHOR_ATTR}]`)).sort(
    (a, b) => rankOf(a) - rankOf(b),
  );
}

/** Annonce un changement de l'ensemble — appelée par le marqueur, jamais par le calque. */
export function announcePoiAnchors(container: HTMLElement): void {
  container.dispatchEvent(new CustomEvent(POI_ANCHORS_EVENT));
}

/**
 * S'abonne aux pastilles d'un conteneur : `listen` est joué **tout de suite** avec celles qui
 * existent déjà (le calque peut se monter après elles comme avant elles), puis à chaque annonce.
 * Rend le désabonnement.
 */
export function subscribePoiAnchors(
  container: HTMLElement | null,
  listen: (anchors: HTMLElement[]) => void,
): () => void {
  listen(poiAnchors(container));
  if (!container) return () => undefined;
  const onChange = () => listen(poiAnchors(container));
  container.addEventListener(POI_ANCHORS_EVENT, onChange);
  return () => container.removeEventListener(POI_ANCHORS_EVENT, onChange);
}

/** Deux listes de pastilles identiques, nœud pour nœud — un calque n'a alors rien à refaire. */
export function sameAnchors(a: readonly HTMLElement[], b: readonly HTMLElement[]): boolean {
  return a.length === b.length && a.every((el, i) => el === b[i]);
}
