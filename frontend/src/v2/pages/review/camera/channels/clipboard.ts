// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  CHANNEL_IDS,
  upsertFullKey,
  type CameraAnimV2,
  type ChannelId,
  type CurveKey,
  type KeyRef,
  type TangentMode,
  type TangentType,
} from './model';
import { clampWeight, TANGENT_TYPES } from './tangents';

/**
 * Key clipboard of the curve editor (Phase 40, 40.E): copy/paste keys (value, mode and
 * tangents) between channels, within the same media **or from one media to another** via
 * `localStorage`. Times are stored **relative** to the earliest selected key; pasting places
 * them starting from the playhead. Pure/testable logic — the state lives in `useCameraAnim`.
 */
export interface CurveClipboard {
  /** Keys copied per channel, relative times (ms) from the earliest of the selection. */
  channels: Partial<Record<ChannelId, CurveKey[]>>;
}

const STORE_KEY = 'review.curveClipboard';
const MODES: readonly TangentMode[] = ['auto', 'linear', 'step', 'free'];

/** Extracts the selected keys, times rebased on the earliest. `null` if nothing is copyable. */
export function copyKeys(anim: CameraAnimV2, refs: readonly KeyRef[]): CurveClipboard | null {
  const collected: Array<{ channel: ChannelId; key: CurveKey }> = [];
  for (const r of refs) {
    const k = anim.channels[r.channel]?.keys[r.index];
    if (k) collected.push({ channel: r.channel, key: { ...k } });
  }
  if (!collected.length) return null;
  const minT = Math.min(...collected.map((c) => c.key.t));
  const channels: Partial<Record<ChannelId, CurveKey[]>> = {};
  for (const { channel, key } of collected) {
    (channels[channel] ??= []).push({ ...key, t: key.t - minT });
  }
  for (const id of CHANNEL_IDS) channels[id]?.sort((a, b) => a.t - b.t);
  return { channels };
}

/**
 * Pastes the clipboard keys starting at time `atT` (ms) on their original channels.
 * Returns the resulting animation and the selection of the pasted keys (to chain a move).
 */
export function pasteKeys(
  anim: CameraAnimV2,
  clip: CurveClipboard,
  atT: number,
): { anim: CameraAnimV2; selection: KeyRef[] } {
  const base = Math.max(0, Math.round(atT));
  let next = anim;
  for (const id of CHANNEL_IDS) {
    for (const k of clip.channels[id] ?? []) next = upsertFullKey(next, id, { ...k, t: base + k.t });
  }
  // Selection = indices of the pasted keys in the resulting sorted animation.
  const selection: KeyRef[] = [];
  for (const id of CHANNEL_IDS) {
    const keys = clip.channels[id];
    const ch = next.channels[id];
    if (!keys || !ch) continue;
    for (const k of keys) {
      const idx = ch.keys.findIndex((kk) => kk.t === base + k.t);
      if (idx >= 0) selection.push({ channel: id, index: idx });
    }
  }
  return { anim: next, selection };
}

// ── Cross-media persistence (localStorage) ─────────────────────────────────────
const sideType = (v: unknown): TangentType | undefined =>
  TANGENT_TYPES.includes(v as TangentType) ? (v as TangentType) : undefined;

function parseKey(input: unknown): CurveKey | null {
  if (!input || typeof input !== 'object') return null;
  const k = input as Record<string, unknown>;
  if (typeof k.t !== 'number' || typeof k.v !== 'number') return null;
  const mode = MODES.includes(k.mode as TangentMode) ? (k.mode as TangentMode) : 'auto';
  const key: CurveKey = { t: k.t, v: k.v, mode };
  if (typeof k.tin === 'number') key.tin = k.tin;
  if (typeof k.tout === 'number') key.tout = k.tout;
  // Separate sides, break and weights: without them, a paste coming from storage returned a key
  // stripped down where the in-memory paste kept everything.
  const modeIn = sideType(k.modeIn);
  const modeOut = sideType(k.modeOut);
  if (modeIn) key.modeIn = modeIn;
  if (modeOut) key.modeOut = modeOut;
  if (k.broken === true) key.broken = true;
  if (typeof k.wIn === 'number') key.wIn = clampWeight(k.wIn);
  if (typeof k.wOut === 'number') key.wOut = clampWeight(k.wOut);
  return key;
}

/** Validates an unknown shape (network/storage JSON) as a `CurveClipboard`, otherwise `null`. */
export function parseClipboard(input: unknown): CurveClipboard | null {
  if (!input || typeof input !== 'object') return null;
  const src = (input as { channels?: unknown }).channels;
  if (!src || typeof src !== 'object') return null;
  const channels: Partial<Record<ChannelId, CurveKey[]>> = {};
  for (const id of CHANNEL_IDS) {
    const raw = (src as Record<string, unknown>)[id];
    if (!Array.isArray(raw)) continue;
    const keys = raw.map(parseKey).filter((k): k is CurveKey => k != null);
    if (keys.length) channels[id] = keys;
  }
  return Object.keys(channels).length ? { channels } : null;
}

export function persistClipboard(clip: CurveClipboard): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(clip));
  } catch {
    /* storage unavailable: the clipboard stays in memory */
  }
}

export function loadClipboard(): CurveClipboard | null {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? parseClipboard(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}
