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
