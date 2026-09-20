// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { UsdPrim } from '../../../types/api';

/**
 * Scenegraph USD de la review (Phase 46, 46.A) — logique **pure et testable**.
 *
 * Deux arbres coexistent et ne coïncident pas toujours :
 *  - l'**arbre USD** rapporté par l'analyseur : la vérité sémantique (types, variantes,
 *    purposes), y compris les prims non rendus ;
 *  - l'**arbre glTF** réellement chargé dans Three : ce que le spectateur voit et manipule.
 *
 * L'importeur USD de Blender n'expose aucun chemin de prim ; on le reconstruit à l'export
 * depuis la hiérarchie d'objets, qui peut **collapser ou insérer** un niveau (une référence
 * dont la racine porte le même nom que le prim référençant, par exemple). D'où `matchPrimPath`,
 * qui apparie les deux au lieu d'exiger une égalité stricte.
 */

/** Nœud d'arbre : un prim et ses enfants. */
export interface PrimNode extends UsdPrim {
  children: PrimNode[];
}

/** Segments d'un chemin USD (`/World/Asset` → `['World','Asset']`). */
export function primSegments(path: string): string[] {
  return path.split('/').filter(Boolean);
}

/** Chemin du parent, ou `null` pour un prim de premier niveau. */
export function parentPath(path: string): string | null {
  const segments = primSegments(path);
  return segments.length <= 1 ? null : `/${segments.slice(0, -1).join('/')}`;
}

/** Dernier segment d'un chemin (nom du prim). */
export function leafName(path: string): string {
  return primSegments(path).at(-1) ?? '';
}

/** Vrai si `path` est `ancestor` lui-même ou l'un de ses descendants. */
export function isSelfOrDescendant(path: string, ancestor: string): boolean {
  return path === ancestor || path.startsWith(`${ancestor}/`);
}

/** Ancêtres d'un chemin, de la racine à son parent (`/a/b/c` → `['/a','/a/b']`). */
export function ancestorPaths(path: string): string[] {
  const out: string[] = [];
  for (let parent = parentPath(path); parent; parent = parentPath(parent)) out.unshift(parent);
  return out;
}

/**
 * `kind` USD de la hiérarchie de modèle visé par défaut : le niveau « objet » d'une scène de
 * production (une chaise, une casserole), celui dans lequel un chef déco raisonne.
 */
const COMPONENT_KIND = 'component';

/** Table `chemin → kind` d'une liste de prims — entrée de `promoteToKind`. */
export function primKinds(prims: readonly UsdPrim[]): Map<string, string> {
  return new Map(prims.map((p) => [p.path, p.kind]));
}

export interface PromoteOptions {
  /** `kind` par chemin de prim (`primKinds`) — seule source de la promotion. */
  kinds: ReadonlyMap<string, string>;
  /**
   * Chemins réellement manipulables, c'est-à-dire indexés dans la scène Three. Un ancêtre qui
   * n'y est pas ne porte **aucun objet** : le promouvoir donnerait une sélection sans halo, sans
   * cadrage et sans gizmo. Absent ⇒ pas de filtre (usage purement sémantique).
   */
  selectable?: ReadonlySet<string>;
  /** `kind` visé — `component` par défaut. */
  kind?: string;
}

/**
 * Remonte un chemin de prim jusqu'au **component** englobant : le clic dans le viewer touche une
 * feuille (`.../Chair_1/Geom/Seat`), mais l'objet que l'utilisateur désigne est la chaise.
 *
 * Le repli ne perd **jamais** la sélection : sans ancêtre éligible — arbre tronqué
 * (`MAX_PRIMS_REPORTED`), niveaux implicites au `kind` vide, ancêtre non indexé — le chemin
 * d'origine est rendu tel quel. Un chemin nul (aucune correspondance) reste nul.
 *
 * Pure et sans dépendance à Three : c'est la seule promotion du module, et elle n'a lieu qu'à la
 * **résolution du clic** — jamais à l'écriture d'un override, dont les chemins déjà enregistrés
 * visent des feuilles.
 */
export function promoteToKind(path: string | null, opts: PromoteOptions): string | null {
  if (!path) return null;
  const target = opts.kind ?? COMPONENT_KIND;
  for (let p: string | null = path; p; p = parentPath(p)) {
    if (opts.kinds.get(p) !== target) continue;
    if (opts.selectable && !opts.selectable.has(p)) continue;
    return p;
  }
  return path;
}

/** Prim synthétique pour un niveau intermédiaire absent de la liste (arbre tronqué). */
function implicitPrim(path: string): UsdPrim {
  return {
    path,
    name: leafName(path),
    type: '',
    kind: '',
    purpose: '',
    variantSets: [],
    active: true,
    instanceable: false,
  };
}

/**
 * Reconstruit la hiérarchie depuis la liste plate : les chemins la portent entièrement.
 * Les niveaux intermédiaires manquants (liste tronquée, prim filtré) sont créés implicitement
 * pour qu'aucune branche ne se retrouve orpheline à la racine.
 */
export function buildPrimTree(prims: UsdPrim[]): PrimNode[] {
  const nodes = new Map<string, PrimNode>();
  const ensure = (prim: UsdPrim): PrimNode => {
    const existing = nodes.get(prim.path);
    if (existing) {
      // Un prim réel remplace le nœud implicite créé pour lui servir de parent.
      if (!existing.type && prim.type) Object.assign(existing, prim, { children: existing.children });
      return existing;
    }
    const node: PrimNode = { ...prim, children: [] };
    nodes.set(prim.path, node);
    return node;
  };

  // Premier passage : chaque prim **et toute sa lignée d'ancêtres** existent comme nœud, pour
  // que le rattachement du second passage ne rencontre jamais de parent manquant.
  for (const prim of prims) {
    ensure(prim);
    for (let parent = parentPath(prim.path); parent; parent = parentPath(parent))
      ensure(implicitPrim(parent));
  }

  const roots: PrimNode[] = [];
  for (const node of nodes.values()) {
    const parent = parentPath(node.path);
    if (parent === null) roots.push(node);
    else nodes.get(parent)!.children.push(node);
  }

  const sort = (list: PrimNode[]): PrimNode[] => {
    list.sort((a, b) => a.name.localeCompare(b.name));
    for (const child of list) sort(child.children);
    return list;
  };
  return sort(roots);
}

/**
 * Arbre complet de la scène **telle qu'elle est réellement chargée** : les prims de l'analyseur,
 * plus des prims implicites pour les chemins rendus qu'il ne connaît pas. L'analyseur compose la
 * scène avec **une seule** option par jeu de variantes — la géométrie des autres options, cuite
 * dans le GLB (46.G), n'existe pas dans son arbre. Sans ces prims implicites, la sélectionner ou
 * l'isoler était impossible : l'isolement retombait sur le parent connu le plus proche.
 * Les artefacts d'export Blender (`_materials`) sont tenus hors de l'arbre.
 */
export function buildRenderedPrimTree(prims: UsdPrim[], renderedPaths: Iterable<string>): PrimNode[] {
  const known = new Set(prims.map((p) => p.path));
  const ghosts: UsdPrim[] = [];
  for (const path of renderedPaths) {
    if (known.has(path) || leafName(path) === '_materials') continue;
    known.add(path);
    ghosts.push(implicitPrim(path));
  }
  return buildPrimTree([...prims, ...ghosts]);
}

/**
 * Apparie un chemin reconstruit côté glTF au prim USD correspondant. Égalité stricte d'abord ;
 * sinon, parmi les prims de **même nom de feuille**, celui qui partage le plus long préfixe —
 * ce qui absorbe un niveau collapsé ou inséré. Renvoie `null` si rien ne correspond ou si le
 * meilleur score est ambigu (deux prims aussi plausibles).
 */
export function matchPrimPath(candidate: string, usdPaths: string[]): string | null {
  if (usdPaths.includes(candidate)) return candidate;

  const leaf = leafName(candidate);
  const candidateSegments = primSegments(candidate);
  let best: { path: string; score: number; length: number } | null = null;
  let ambiguous = false;

  for (const path of usdPaths) {
    if (leafName(path) !== leaf) continue;
    const segments = primSegments(path);
    let common = 0;
    while (
      common < segments.length - 1 &&
      common < candidateSegments.length - 1 &&
      segments[common] === candidateSegments[common]
    )
      common += 1;

    if (!best || common > best.score || (common === best.score && segments.length < best.length)) {
      ambiguous = best !== null && common === best.score && segments.length === best.length;
      best = { path, score: common, length: segments.length };
    } else if (common === best.score && segments.length === best.length) {
      ambiguous = true;
    }
  }

  return best && !ambiguous ? best.path : null;
}

/** Chemins de l'arbre en ordre d'affichage (pré-ordre) — plage Maj+clic du scenegraph (B1). */
export function flattenTree(tree: PrimNode[]): string[] {
  const out: string[] = [];
  const walk = (nodes: PrimNode[]) => {
    for (const node of nodes) {
      out.push(node.path);
      walk(node.children);
    }
  };
  walk(tree);
  return out;
}

/** Deux premiers niveaux : dépliage par défaut du scenegraph, assez pour situer la scène. */
export function initialExpansion(tree: readonly PrimNode[]): Set<string> {
  return new Set(tree.flatMap((n) => [n.path, ...n.children.map((c) => c.path)]));
}

/** Résultat d'une recherche dans l'arbre : ce qui reste visible, et ce qu'il faut déplier. */
export interface PrimSearch {
  /** Arbre filtré : les correspondances et leurs ancêtres, rien d'autre. */
  tree: PrimNode[];
  /**
   * Nœuds à déplier de force — **uniquement** le chemin menant à une correspondance. Ce sont
   * les nœuds internes de l'arbre filtré : une correspondance sans descendance retenue reste
   * fermée, et taper « table » ne déroule plus toute la table.
   */
  expand: ReadonlySet<string>;
}

/** Aucun dépliage forcé : instance partagée pour que la mémoïsation des rangées tienne. */
const NO_EXPANSION: ReadonlySet<string> = new Set<string>();

/**
 * Recherche dans l'arbre (insensible à la casse) : un nœud reste si lui ou l'un de ses
 * descendants correspond — les ancêtres d'un résultat restent visibles pour situer le prim.
 *
 * La correspondance porte sur le **nom**, pas sur le chemin : comparer le chemin complet faisait
 * correspondre tout ce qui descend d'un nœud trouvé (« table » retenait `/…/table/…/vis_037`),
 * et l'arbre se dépliait entièrement. Une requête contenant une barre est en revanche une
 * intention de chemin explicite, et se compare au chemin.
 */
export function searchPrimTree(tree: PrimNode[], query: string): PrimSearch {
  const q = query.trim().toLowerCase();
  if (!q) return { tree, expand: NO_EXPANSION };
  const byPath = q.includes('/');
  const expand = new Set<string>();
  const keep = (node: PrimNode): PrimNode | null => {
    const children = node.children.map(keep).filter((n): n is PrimNode => n !== null);
    const self = (byPath ? node.path : node.name).toLowerCase().includes(q);
    if (!self && children.length === 0) return null;
    if (children.length > 0) expand.add(node.path);
    return { ...node, children };
  };
  return { tree: tree.map(keep).filter((n): n is PrimNode => n !== null), expand };
}
