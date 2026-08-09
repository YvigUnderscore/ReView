// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { UsdPurpose } from '../../../types/api';
import { isSelfOrDescendant, parentPath } from './usdScenegraph';

/**
 * « ReView override » (Phase 46, 46.B) — logique **pure et testable**.
 *
 * Ce n'est **pas** de l'USD : c'est un delta propre à ReView, appliqué à la scène **au
 * chargement**, sans reconversion ni job worker. Il dit simplement « ce prim a été déplacé
 * ici, mis à cette échelle, masqué, ce look forcé ». D'où sa forme : un dictionnaire
 * `chemin de prim → édition`, assez léger pour tenir dans les métadonnées d'un média ou dans
 * une annotation de commentaire.
 *
 * La transformation est un **delta** posé par-dessus celle du fichier, jamais une valeur
 * absolue : une reconversion du média (nouvelle variante, nouvel export) peut changer les
 * transformations d'origine sans invalider l'override.
 *
 * Deux étages se composent : l'override **de base** du média (réglé avant publication, figé
 * ensuite, rejoué pour tout le monde) et le delta **porté par un commentaire** (proposition
 * d'un reviewer, rejouée seulement quand ce commentaire est sélectionné).
 */

/** Delta de transformation : translation, rotation (radians, euler XYZ) et échelle. */
export interface PrimTransform {
  t: [number, number, number];
  r: [number, number, number];
  s: [number, number, number];
}

/**
 * Clone de mise en scène (C1) : une copie du prim, purement côté override — la géométrie du
 * GLB est dupliquée au chargement, aucune reconversion. `transform` est le delta du clone par
 * rapport à l'état d'origine du prim source (même convention que `PrimEdit.transform`).
 */
export interface PrimClone {
  id: string;
  transform: PrimTransform;
}

/** Édition d'un prim. Chaque champ est optionnel : seul ce qui diffère est stocké. */
export interface PrimEdit {
  /** Visibilité forcée — masque aussi la descendance (comportement `Object3D.visible`). */
  visible?: boolean;
  transform?: PrimTransform;
  /** Look forcé sur ce prim : `{ lookVariant: 'dirty' }`. */
  variants?: Record<string, string>;
  /** Clones de mise en scène du prim (C1) — set-dressing léger sans reconversion. */
  clones?: PrimClone[];
}

export interface SceneOverride {
  version: 1;
  /** Purpose affiché (global à la scène), absent = celui de la conversion. */
  purpose?: UsdPurpose;
  prims: Record<string, PrimEdit>;
}

/** Borne de volume : un override réaliste touche quelques prims, pas des milliers. */
export const MAX_OVERRIDE_PRIMS = 500;

export const IDENTITY_TRANSFORM: PrimTransform = { t: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] };

export const emptyOverride = (): SceneOverride => ({ version: 1, prims: {} });

const isVec3 = (v: unknown): v is [number, number, number] =>
  Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n));

const sameVec = (a: readonly number[], b: readonly number[]) =>
  a.every((n, i) => Math.abs(n - (b[i] ?? 0)) < 1e-6);

/** Vrai si la transformation ne change rien (identité) — inutile de la stocker. */
export function isIdentityTransform(t: PrimTransform): boolean {
  return (
    sameVec(t.t, IDENTITY_TRANSFORM.t) &&
    sameVec(t.r, IDENTITY_TRANSFORM.r) &&
    sameVec(t.s, IDENTITY_TRANSFORM.s)
  );
}

/** Vrai si l'édition est vide de sens (aucun champ effectif). */
export function isEmptyEdit(edit: PrimEdit): boolean {
  if (edit.visible !== undefined) return false;
  if (edit.transform && !isIdentityTransform(edit.transform)) return false;
  if (edit.variants && Object.keys(edit.variants).length > 0) return false;
  if (edit.clones && edit.clones.length > 0) return false;
  return true;
}

export function isEmptyOverride(override: SceneOverride | null | undefined): boolean {
  if (!override) return true;
  if (override.purpose) return false;
  return Object.keys(override.prims).length === 0;
}

/** Nombre de prims réellement édités — affiché à l'utilisateur avant d'enregistrer. */
export function countEdits(override: SceneOverride | null | undefined): number {
  return override ? Object.keys(override.prims).length : 0;
}

/**
 * Nettoie une valeur venue du réseau ou du stockage : rejette ce qui n'a pas la bonne forme,
 * supprime les éditions sans effet et borne le volume. Ne lève jamais — un override corrompu
 * ne doit pas empêcher d'ouvrir la review.
 */
export function normalizeOverride(raw: unknown): SceneOverride {
  const source = (raw ?? {}) as Partial<SceneOverride>;
  const result = emptyOverride();

  if (source.purpose === 'render' || source.purpose === 'proxy' || source.purpose === 'guide')
    result.purpose = source.purpose;

  const prims = (source.prims ?? {}) as Record<string, unknown>;
  for (const path of Object.keys(prims)) {
    if (Object.keys(result.prims).length >= MAX_OVERRIDE_PRIMS) break;
    if (!path.startsWith('/')) continue;
    const raw = prims[path] as Partial<PrimEdit> | null;
    if (!raw || typeof raw !== 'object') continue;

    const edit: PrimEdit = {};
    if (typeof raw.visible === 'boolean') edit.visible = raw.visible;
    const t = raw.transform;
    if (t && isVec3(t.t) && isVec3(t.r) && isVec3(t.s) && !isIdentityTransform(t))
      edit.transform = { t: [...t.t], r: [...t.r], s: [...t.s] };
    if (raw.variants && typeof raw.variants === 'object') {
      const variants: Record<string, string> = {};
      for (const [name, value] of Object.entries(raw.variants))
        if (typeof value === 'string' && value) variants[name] = value;
      if (Object.keys(variants).length > 0) edit.variants = variants;
    }
    if (Array.isArray(raw.clones)) {
      const clones: PrimClone[] = [];
      const seen = new Set<string>();
      for (const c of raw.clones as Array<Partial<PrimClone> | null>) {
        if (!c || typeof c.id !== 'string' || !c.id || seen.has(c.id)) continue;
        const ct = c.transform;
        // L'identité est valide pour un clone : une copie posée au même endroit a un sens.
        if (!ct || !isVec3(ct.t) || !isVec3(ct.r) || !isVec3(ct.s)) continue;
        seen.add(c.id);
        clones.push({ id: c.id, transform: { t: [...ct.t], r: [...ct.r], s: [...ct.s] } });
      }
      if (clones.length > 0) edit.clones = clones;
    }
    if (!isEmptyEdit(edit)) result.prims[path] = edit;
  }
  return result;
}

/**
 * Superpose `delta` (proposition d'un commentaire) sur `base` (override du média). Champ par
 * champ : une proposition qui ne touche que la visibilité d'un prim ne doit pas effacer la
 * transformation que l'override de base lui applique.
 */
export function mergeOverrides(
  base: SceneOverride | null | undefined,
  delta: SceneOverride | null | undefined,
): SceneOverride {
  const merged = normalizeOverride(base);
  const top = normalizeOverride(delta);
  if (top.purpose) merged.purpose = top.purpose;
  for (const [path, edit] of Object.entries(top.prims)) {
    const current = merged.prims[path] ?? {};
    // Clones fusionnés par id : la proposition met à jour un clone existant ou en ajoute.
    const clones =
      current.clones || edit.clones
        ? [
            ...(current.clones ?? []).filter((c) => !(edit.clones ?? []).some((e) => e.id === c.id)),
            ...(edit.clones ?? []),
          ]
        : undefined;
    merged.prims[path] = {
      ...current,
      ...edit,
      ...(current.variants || edit.variants
        ? { variants: { ...(current.variants ?? {}), ...(edit.variants ?? {}) } }
        : {}),
      ...(clones ? { clones } : {}),
    };
  }
  return merged;
}

/** Remplace l'édition d'un prim (immutable). Une édition devenue vide est retirée. */
export function setPrimEdit(override: SceneOverride, path: string, patch: PrimEdit | null): SceneOverride {
  const prims = { ...override.prims };
  if (patch === null) delete prims[path];
  else {
    const next = { ...(prims[path] ?? {}), ...patch };
    if (next.transform && isIdentityTransform(next.transform)) delete next.transform;
    if (next.variants && Object.keys(next.variants).length === 0) delete next.variants;
    if (next.clones && next.clones.length === 0) delete next.clones;
    if (isEmptyEdit(next)) delete prims[path];
    else prims[path] = next;
  }
  return { ...override, prims };
}

// ── Clones de mise en scène (C1) ─────────────────────────────────────────────────────────────

/** Séparateur du pseudo-chemin d'un clone : `/World/Chair#c3` désigne le clone `c3` du prim. */
const CLONE_SEP = '#';

export const isClonePath = (path: string): boolean => path.includes(CLONE_SEP);

/** Pseudo-chemin d'un clone — utilisé par la sélection, le gizmo et l'arbre. */
export const clonePath = (path: string, id: string): string => `${path}${CLONE_SEP}${id}`;

/** Décompose un pseudo-chemin de clone en (prim source, id), ou null. */
export function parseClonePath(pseudo: string): { path: string; id: string } | null {
  const i = pseudo.indexOf(CLONE_SEP);
  if (i <= 0 || i === pseudo.length - 1) return null;
  return { path: pseudo.slice(0, i), id: pseudo.slice(i + 1) };
}

/** Identifiant de clone raisonnablement unique dans un override. */
export function newCloneId(): string {
  return `c${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export function clonesOf(override: SceneOverride, path: string): PrimClone[] {
  return override.prims[path]?.clones ?? [];
}

/** Ajoute un clone au prim (immutable). */
export function addClone(override: SceneOverride, path: string, clone: PrimClone): SceneOverride {
  return setPrimEdit(override, path, { clones: [...clonesOf(override, path), clone] });
}

/** Retire un clone (immutable) — no-op si absent. */
export function removeClone(override: SceneOverride, path: string, id: string): SceneOverride {
  const rest = clonesOf(override, path).filter((c) => c.id !== id);
  return setPrimEdit(override, path, { clones: rest });
}

/** Remplace le delta d'un clone (immutable). */
export function setCloneTransform(
  override: SceneOverride,
  path: string,
  id: string,
  transform: PrimTransform,
): SceneOverride {
  const clones = clonesOf(override, path).map((c) => (c.id === id ? { ...c, transform } : c));
  return setPrimEdit(override, path, { clones });
}

/**
 * Vrai si le prim est masqué par un **ancêtre** plutôt que par lui-même : l'arbre le grise
 * sans le présenter comme masqué à titre propre (le rétablir n'aurait aucun effet visible).
 */
export function isHiddenByAncestor(override: SceneOverride, path: string): boolean {
  for (let parent = parentPath(path); parent; parent = parentPath(parent))
    if (override.prims[parent]?.visible === false) return true;
  return false;
}

/** Vrai si le prim est masqué, directement ou par héritage. */
export function isHidden(override: SceneOverride, path: string): boolean {
  return override.prims[path]?.visible === false || isHiddenByAncestor(override, path);
}

/**
 * Isole un prim : masque ses frères à chaque niveau, en gardant visibles sa lignée d'ancêtres
 * et toute sa descendance. Rendu classique d'un scenegraph de DCC.
 *
 * Seuls les **frères directs de la lignée** reçoivent `visible: false` — l'héritage de
 * visibilité masque leur descendance gratuitement. Écrire une entrée par prim masqué, comme
 * avant, dépassait la borne `MAX_OVERRIDE_PRIMS` sur une scène riche (Kitchen_set : des
 * milliers de prims) : la troncature silencieuse laissait la moitié de la scène visible.
 */
export function isolatePrim(
  override: SceneOverride,
  path: string,
  allPaths: readonly string[],
): SceneOverride {
  const lineage = new Set<string>();
  for (let p: string | null = path; p; p = parentPath(p)) lineage.add(p);

  let next = override;
  for (const candidate of allPaths) {
    // La lignée et la descendance du prim redeviennent visibles (annule un masquage antérieur).
    if (isSelfOrDescendant(path, candidate) || isSelfOrDescendant(candidate, path)) {
      next = setPrimEdit(next, candidate, { visible: undefined });
      continue;
    }
    // Frère direct d'un maillon de la lignée (ou prim de premier niveau hors lignée) : masqué,
    // et tout son sous-arbre avec lui par héritage.
    const parent = parentPath(candidate);
    const sibling =
      parent === null ? !lineage.has(candidate) : lineage.has(parent) && !lineage.has(candidate);
    if (sibling) next = setPrimEdit(next, candidate, { visible: false });
  }
  return next;
}
