// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Hotspot3D } from '../reviewTypes';

/**
 * Points of interest of a comment: a **pure** model, hence readable and testable without a viewer.
 *
 * SETTLED FORM: **one carrying comment, numbered points**. A single comment is sent. It carries the
 * geometry of each point (in OBJECT space, like the hotspots and the brush strokes, hence replayed
 * identically for every viewer), the remark specific to each point, and the images. The images are
 * attached to the comment only once, each point noting which are its own by their MinIO key.
 *
 * This choice leaves the rest of the product unchanged: the client portal, the notes export and the
 * ShotGrid bridge read `content`, where the remarks are copied numbered.
 */

/** Ceiling of points per comment: mirror of `MAX_POI_POINTS` (backend Zod). */
export const MAX_POI_POINTS = 20;

/** Point of interest as it is STORED in the `poi` part of `Comment.annotation`. */
export interface PoiPoint extends Hotspot3D {
  /** Remark specific to this point, copied numbered into the comment's text. */
  text?: string;
  /** Keys of the comment's attachments that belong to this point. */
  images?: string[];
}

/** Annotation part carried by the comment (a single one, with all the points inside). */
export interface PoiPart {
  type: 'poi';
  points: PoiPoint[];
}

/** A readable position is enough to make a point; the text and the images are optional. */
function readPoint(value: unknown): PoiPoint | null {
  if (!value || typeof value !== 'object') return null;
  const p = value as Partial<PoiPoint>;
  if (typeof p.position !== 'string' || typeof p.normal !== 'string') return null;
  const images = Array.isArray(p.images) ? p.images.filter((k) => typeof k === 'string') : undefined;
  return {
    position: p.position,
    normal: p.normal,
    ...(p.space === 'object' ? { space: 'object' as const } : {}),
    ...(typeof p.text === 'string' && p.text ? { text: p.text } : {}),
    ...(images && images.length ? { images } : {}),
  };
}

/**
 * Points of a comment, in their placement order (their number is their rank + 1).
 *
 * **Tolerant** reading, like the rest of `splitAnnotationParts`: a comment written before this form
 * carries only a `hotspot` part, and is therefore worth exactly one numbered point, "1". Nothing is
 * rewritten in the database: it is the reading that unifies the two generations.
 */
export function readPoiPoints(annotation: unknown): PoiPoint[] {
  if (!Array.isArray(annotation)) return [];
  const parts = annotation as { type?: string; points?: unknown }[];
  const part = parts.find((x) => x?.type === 'poi');
  if (part && Array.isArray(part.points)) {
    const points = part.points.map(readPoint).filter((p): p is PoiPoint => p !== null);
    if (points.length) return points.slice(0, MAX_POI_POINTS);
  }
  const legacy = readPoint(parts.find((x) => x?.type === 'hotspot'));
  return legacy ? [legacy] : [];
}

/** Part to attach to the comment, or `null` if no point has been placed. */
export function buildPoiPart(points: readonly PoiPoint[]): PoiPart | null {
  const kept = points.slice(0, MAX_POI_POINTS);
  return kept.length ? { type: 'poi', points: kept.map((p) => ({ ...p })) } : null;
}

/** Numbered line of a point: "3. the weld is visible" (number alone if nothing is written). */
export function poiLine(index: number, text?: string): string {
  const note = (text ?? '').trim();
  return note ? `${index + 1}. ${note}` : `${index + 1}.`;
}

/** Complete numbered block, as it is copied at the tail of the comment's text. */
export function poiBlock(points: readonly { text?: string }[]): string {
  return points.map((p, i) => poiLine(i, p.text)).join('\n');
}

/**
 * Text of the carrying comment: what the author wrote, then the numbered block. The block is copied there
 * so that everything that reads only `content` (client portal, notes export, ShotGrid note) sees the
 * remarks point by point without knowing anything about the annotation.
 *
 * `fallback` is used in case there is neither text nor point: it is the minimal placeholder that the
 * backend's content constraint requires.
 */
export function poiContent(text: string, points: readonly { text?: string }[], fallback: string): string {
  const head = text.trim();
  const block = poiBlock(points);
  if (head && block) return `${head}\n\n${block}`;
  return head || block || fallback;
}

/**
 * The exact inverse of `poiContent`: returns the author's text, without the numbered block that the
 * comments column renders itself as clickable rows. If the tail does not match (comment edited by hand,
 * imported note), nothing is removed: a visible duplicate is preferred over a truncated sentence.
 */
export function stripPoiBlock(content: string, points: readonly { text?: string }[]): string {
  const block = poiBlock(points);
  if (!block) return content;
  const trimmed = content.trimEnd();
  if (!trimmed.endsWith(block)) return content;
  return trimmed.slice(0, trimmed.length - block.length).trimEnd();
}
