// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { UsdPurpose } from '@/v2/types/api';
import { isSelfOrDescendant, parentPath } from './usdScenegraph';

/**
 * "ReView override" (Phase 46, 46.B) — **pure and testable** logic.
 *
 * This is **not** USD: it is a delta specific to ReView, applied to the scene **at load time**,
 * without reconversion or worker job. It simply says "this prim was moved here, set to this scale,
 * hidden, this look forced". Hence its shape: a dictionary `prim path → edit`, light enough to fit
 * in a media's metadata or in a comment annotation.
 *
 * The transform is a **delta** laid on top of the one from the file, never an absolute value: a
 * reconversion of the media (new variant, new export) may change the original transforms without
 * invalidating the override.
 *
 * Two layers compose: the media's **base** override (set before publication, frozen afterwards,
 * replayed for everyone) and the delta **carried by a comment** (a reviewer's proposal, replayed
 * only when that comment is selected).
 */

/** Transform delta: translation, rotation (radians, Euler XYZ) and scale. */
export interface PrimTransform {
  t: [number, number, number];
  r: [number, number, number];
  s: [number, number, number];
}

/**
 * Staging clone (C1): a copy of the prim, purely on the override side — the GLB geometry is
 * duplicated at load time, no reconversion. `transform` is the clone's delta relative to the
 * original state of the source prim (same convention as `PrimEdit.transform`).
 */
export interface PrimClone {
  id: string;
  transform: PrimTransform;
}

/** Edit of a prim. Each field is optional: only what differs is stored. */
export interface PrimEdit {
  /** Forced visibility — also hides the descendants (`Object3D.visible` behavior). */
  visible?: boolean;
  transform?: PrimTransform;
  /** Forced look on this prim: `{ lookVariant: 'dirty' }`. */
  variants?: Record<string, string>;
  /** Staging clones of the prim (C1) — light set dressing without reconversion. */
  clones?: PrimClone[];
}

export interface SceneOverride {
  version: 1;
  /** Displayed purpose (global to the scene), absent = that of the conversion. */
  purpose?: UsdPurpose;
  prims: Record<string, PrimEdit>;
}

/** Volume bound: a realistic override touches a few prims, not thousands. */
export const MAX_OVERRIDE_PRIMS = 500;

export const IDENTITY_TRANSFORM: PrimTransform = { t: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] };

export const emptyOverride = (): SceneOverride => ({ version: 1, prims: {} });

const isVec3 = (v: unknown): v is [number, number, number] =>
  Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n));

const sameVec = (a: readonly number[], b: readonly number[]) =>
  a.every((n, i) => Math.abs(n - (b[i] ?? 0)) < 1e-6);

/** True if the transform changes nothing (identity) — no point storing it. */
export function isIdentityTransform(t: PrimTransform): boolean {
  return (
    sameVec(t.t, IDENTITY_TRANSFORM.t) &&
    sameVec(t.r, IDENTITY_TRANSFORM.r) &&
    sameVec(t.s, IDENTITY_TRANSFORM.s)
  );
}

/** True if the edit is meaningless (no effective field). */
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

/** Number of prims actually edited — shown to the user before saving. */
export function countEdits(override: SceneOverride | null | undefined): number {
  return override ? Object.keys(override.prims).length : 0;
}

/**
 * Cleans a value coming from the network or from storage: rejects what does not have the right
 * shape, removes edits with no effect and bounds the volume. Never throws — a corrupted override
 * must not prevent opening the review.
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
        // Identity is valid for a clone: a copy placed at the same spot makes sense.
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
 * Overlays `delta` (a comment's proposal) on `base` (the media's override). Field by field: a
 * proposal touching only a prim's visibility must not erase the transform the base override
 * applies to it.
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
    // Clones merged by id: the proposal updates an existing clone or adds one.
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

/** Replaces the edit of a prim (immutable). An edit that became empty is removed. */
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

// ── Staging clones (C1) ─────────────────────────────────────────────────────────────

/** Separator of a clone's pseudo-path: `/World/Chair#c3` designates clone `c3` of the prim. */
const CLONE_SEP = '#';

export const isClonePath = (path: string): boolean => path.includes(CLONE_SEP);

/** Pseudo-path of a clone — used by selection, the gizmo and the tree. */
export const clonePath = (path: string, id: string): string => `${path}${CLONE_SEP}${id}`;

/** Decomposes a clone pseudo-path into (source prim, id), or null. */
export function parseClonePath(pseudo: string): { path: string; id: string } | null {
  const i = pseudo.indexOf(CLONE_SEP);
  if (i <= 0 || i === pseudo.length - 1) return null;
  return { path: pseudo.slice(0, i), id: pseudo.slice(i + 1) };
}

/** Reasonably unique clone identifier within an override. */
export function newCloneId(): string {
  return `c${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export function clonesOf(override: SceneOverride, path: string): PrimClone[] {
  return override.prims[path]?.clones ?? [];
}

/** Adds a clone to the prim (immutable). */
export function addClone(override: SceneOverride, path: string, clone: PrimClone): SceneOverride {
  return setPrimEdit(override, path, { clones: [...clonesOf(override, path), clone] });
}

/** Removes a clone (immutable) — no-op if absent. */
export function removeClone(override: SceneOverride, path: string, id: string): SceneOverride {
  const rest = clonesOf(override, path).filter((c) => c.id !== id);
  return setPrimEdit(override, path, { clones: rest });
}

/** Replaces the delta of a clone (immutable). */
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
 * True if the prim is hidden by an **ancestor** rather than by itself: the tree greys it out without
 * presenting it as hidden in its own right (restoring it would have no visible effect).
 */
export function isHiddenByAncestor(override: SceneOverride, path: string): boolean {
  for (let parent = parentPath(path); parent; parent = parentPath(parent))
    if (override.prims[parent]?.visible === false) return true;
  return false;
}

/** True if the prim is hidden, directly or by inheritance. */
export function isHidden(override: SceneOverride, path: string): boolean {
  return override.prims[path]?.visible === false || isHiddenByAncestor(override, path);
}

/**
 * Isolates a prim: hides its siblings at each level, keeping its ancestry and its whole subtree
 * visible. Classic rendering of a DCC scenegraph.
 *
 * Only the **direct siblings along the lineage** receive `visible: false` — visibility inheritance
 * hides their descendants for free. Writing one entry per hidden prim, as before, exceeded the
 * `MAX_OVERRIDE_PRIMS` bound on a rich scene (Kitchen_set: thousands of prims): the silent
 * truncation left half the scene visible.
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
    // The prim's lineage and descendants become visible again (cancels a previous masking).
    if (isSelfOrDescendant(path, candidate) || isSelfOrDescendant(candidate, path)) {
      next = setPrimEdit(next, candidate, { visible: undefined });
      continue;
    }
    // Direct sibling of a link in the lineage (or top-level prim outside it): hidden, and its
    // whole subtree with it, by inheritance.
    const parent = parentPath(candidate);
    const sibling =
      parent === null ? !lineage.has(candidate) : lineage.has(parent) && !lineage.has(candidate);
    if (sibling) next = setPrimEdit(next, candidate, { visible: false });
  }
  return next;
}
