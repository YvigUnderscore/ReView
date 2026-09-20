// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { UsdModelInfo } from '../../../types/api';
import { clonePath, clonesOf, type SceneOverride } from '../three/sceneOverride';
import type { PrimNode } from '../three/usdScenegraph';

/**
 * Aplatissement du scenegraph USD en **rangées** — arithmétique pure du panneau virtualisé.
 *
 * Virtualiser un arbre n'est pas virtualiser une liste : le virtualiseur ne sait compter que
 * des rangées. On aplatit donc l'arbre **tel qu'il est déplié** (les enfants d'un nœud replié
 * n'existent pas comme rangée), une fois par changement d'arbre ou de dépliage, au lieu de
 * laisser la récursion JSX monter des milliers de composants dont vingt sont visibles.
 *
 * Isolé ici pour être vérifiable sans navigateur — et pour tenir le budget de lignes du panneau.
 */

/** Hauteur estimée d'une rangée avant mesure réelle (`text-xs` + `py-0.5`). */
export const ROW_ESTIMATE = 20;

/** Rangées montées de part et d'autre de la fenêtre : le défilement ne montre pas de vide. */
export const ROW_OVERSCAN = 8;

/** Rangée d'un prim de la scène. */
export interface PrimRowItem {
  kind: 'prim';
  path: string;
  node: PrimNode;
  depth: number;
  /** Nœud déplié **et** porteur d'enfants — c'est ce que dessine le chevron. */
  open: boolean;
}

/** Rangée d'un clone de mise en scène (C1), fille de la rangée du prim source. */
export interface CloneRowItem {
  kind: 'clone';
  /** Pseudo-chemin `/prim#id` : l'identité du clone pour la sélection. */
  path: string;
  name: string;
  depth: number;
}

export type ScenegraphRowItem = PrimRowItem | CloneRowItem;

/** Rien à déplier de force : instance partagée, pour ne pas invalider la mémoïsation. */
const NONE: ReadonlySet<string> = new Set<string>();

/**
 * Rangées visibles, dans l'ordre d'affichage : prim, ses clones, puis ses enfants s'il est
 * déplié. `forceOpen` couvre la recherche : ce sont les nœuds du chemin menant à une
 * correspondance (`searchPrimTree`), et eux seuls — l'ancien dépliage total de l'arbre filtré
 * déroulait toute la descendance d'un résultat, ce que personne n'avait demandé.
 */
export function buildRows(
  tree: readonly PrimNode[],
  expanded: ReadonlySet<string>,
  override: SceneOverride,
  forceOpen: ReadonlySet<string> = NONE,
): ScenegraphRowItem[] {
  const rows: ScenegraphRowItem[] = [];
  const walk = (nodes: readonly PrimNode[], depth: number) => {
    for (const node of nodes) {
      const open = (expanded.has(node.path) || forceOpen.has(node.path)) && node.children.length > 0;
      rows.push({ kind: 'prim', path: node.path, node, depth, open });
      for (const clone of clonesOf(override, node.path))
        rows.push({
          kind: 'clone',
          path: clonePath(node.path, clone.id),
          name: node.name,
          depth: depth + 1,
        });
      if (open) walk(node.children, depth + 1);
    }
  };
  walk(tree, 0);
  return rows;
}

/**
 * Position d'un chemin dans les rangées, `-1` s'il n'en a pas (branche repliée, filtré).
 *
 * C'est la contrepartie de la virtualisation : faire défiler jusqu'à un prim sélectionné
 * depuis le viewer demande un **index**, plus un nœud du DOM — la rangée peut ne pas exister.
 */
export function rowIndexOf(rows: readonly ScenegraphRowItem[], path: string | null): number {
  if (!path) return -1;
  return rows.findIndex((row) => row.path === path);
}

/**
 * Libellé des jeux de variantes d'un prim, indexé une fois par scène.
 *
 * L'ancien `variantSetsOf` refiltrait la liste complète des variantSets pour **chaque** rangée
 * (F18) : sur une scène qui en porte des centaines, l'arbre coûtait un produit de deux tailles.
 */
export function variantTitleIndex(usd: UsdModelInfo | null): ReadonlyMap<string, string> {
  const index = new Map<string, string>();
  for (const set of usd?.variantSets ?? []) {
    const current = index.get(set.prim);
    index.set(set.prim, current ? `${current}, ${set.name}` : set.name);
  }
  return index;
}

/**
 * Prim visé par un clic droit, d'après la cible de l'événement.
 *
 * Le panneau ne monte plus qu'**un** menu contextuel (au lieu d'un par rangée) : c'est donc
 * lui qui doit retrouver la rangée visée, au moment du clic, en remontant le DOM. Les rangées
 * de clones n'en portent pas — elles n'ont jamais eu de menu dans l'arbre.
 */
export function aimedPrimPath(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  return target.closest('[data-prim-path]')?.getAttribute('data-prim-path') ?? null;
}
