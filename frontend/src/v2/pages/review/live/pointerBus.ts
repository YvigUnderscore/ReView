// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useSyncExternalStore } from 'react';

/**
 * Shared cursors of the live review room (a leftover noted by the studio).
 *
 * The session broadcast the playhead, the camera and the wipe, but no pointer: "there, that thing"
 * had no visual support. The existing channel (`live:sync`) now carries a cursor frame; it is
 * **decoupled** from the periodic broadcast, set to 2 Hz by default: a cursor at two images per
 * second points at nothing.
 *
 * A module bus rather than a context: the player (which captures the gesture and displays the cursors)
 * and the live session (which talks to the socket) are at two ends of the tree, and nothing else needs
 * to know. Same approach as `liveSync.ts` for deferred departures.
 */

/** Normalized position within the media frame: 0..1 whatever the viewer's screen. */
export interface PointerFrame {
  userId: number;
  x: number;
  y: number;
  /** The pointer has left the frame: remove it without waiting for expiry. */
  gone?: true;
}

/** Displayed cursor: position, owner, and the instant of the last news. */
export interface LivePointer extends PointerFrame {
  label: string;
  at: number;
}

/** A motionless cursor disappears: otherwise the screen fills up with leftovers. */
export const POINTER_TTL_MS = 2500;
/** Maximum emission rate (~20 Hz): smooth enough, without flooding the relay. */
export const POINTER_INTERVAL_MS = 50;
const SWEEP_MS = 400;

type Emitter = (frame: { x: number; y: number } | null) => void;

let pointers: LivePointer[] = [];
const listeners = new Set<() => void>();
let emitter: Emitter | null = null;
let lastEmit = 0;
let pending: { x: number; y: number } | null = null;
let sendTimer: number | null = null;
let sweepTimer: number | null = null;

const commit = (next: LivePointer[]): void => {
  pointers = next;
  for (const l of listeners) l();
};

const sweep = (): void => {
  if (sweepTimer !== null || pointers.length === 0) return;
  sweepTimer = window.setInterval(() => {
    const now = Date.now();
    const alive = pointers.filter((p) => now - p.at < POINTER_TTL_MS);
    if (alive.length !== pointers.length) commit(alive);
    if (pointers.length === 0 && sweepTimer !== null) {
      window.clearInterval(sweepTimer);
      sweepTimer = null;
    }
  }, SWEEP_MS);
};

/** Cursor frame of a `live:sync` payload: validated, the relay guarantees nothing. */
export function readPointerFrame(payload: unknown): PointerFrame | null {
  const p = (payload as { pointer?: unknown } | null)?.pointer as Partial<PointerFrame> | undefined;
  if (!p || typeof p.userId !== 'number') return null;
  if (p.gone === true) return { userId: p.userId, x: 0, y: 0, gone: true };
  if (typeof p.x !== 'number' || typeof p.y !== 'number') return null;
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
  return { userId: p.userId, x: p.x, y: p.y };
}

/** Applies a received frame: this user's cursor replaces the previous one. */
export function receivePointer(frame: PointerFrame, label: string): void {
  const others = pointers.filter((p) => p.userId !== frame.userId);
  if (frame.gone) {
    if (others.length !== pointers.length) commit(others);
    return;
  }
  commit([...others, { ...frame, label, at: Date.now() }]);
  sweep();
}

/**
 * Applies the cursor frame of a `live:sync` payload, attaching the name of its author. The bus only
 * knows identifiers; the list of participants lives in the session. A payload without a cursor
 * (ordinary periodic broadcast) has no effect.
 */
export function applyPointer(payload: unknown, participants: { id: number; displayName: string }[]): void {
  const frame = readPointerFrame(payload);
  if (!frame) return;
  receivePointer(frame, participants.find((p) => p.id === frame.userId)?.displayName ?? '');
}

/** Clears the screen: end of session, change of driver, departure from the media. */
export function clearPointers(): void {
  if (pointers.length > 0) commit([]);
  if (sweepTimer !== null) {
    window.clearInterval(sweepTimer);
    sweepTimer = null;
  }
}

/**
 * Plugs in (or unplugs) the socket output, set by the driver's live session. Plugging in reopens the
 * emission window: the first position of a takeover goes out at once, without inheriting the rate of a
 * previous session.
 */
export function setPointerEmitter(fn: Emitter | null): void {
  emitter = fn;
  lastEmit = 0;
  pending = null;
  if (sendTimer !== null) {
    window.clearTimeout(sendTimer);
    sendTimer = null;
  }
}

/** Is there anyone to broadcast? (the player avoids computing for nothing). */
export const canSendPointer = (): boolean => emitter !== null;

/**
 * Emits the local position, at most once per `POINTER_INTERVAL_MS`. The last position of a gesture is
 * always transmitted (trailing emission): without it, the spectators' cursor would stop a few pixels
 * before what the driver points at.
 */
export function sendPointer(frame: { x: number; y: number } | null): void {
  if (!emitter) return;
  if (frame === null) {
    if (sendTimer !== null) {
      window.clearTimeout(sendTimer);
      sendTimer = null;
    }
    pending = null;
    emitter(null);
    return;
  }
  const now = Date.now();
  const wait = POINTER_INTERVAL_MS - (now - lastEmit);
  if (wait <= 0) {
    lastEmit = now;
    emitter(frame);
    return;
  }
  pending = frame;
  if (sendTimer !== null) return;
  sendTimer = window.setTimeout(() => {
    sendTimer = null;
    if (!pending || !emitter) return;
    lastEmit = Date.now();
    emitter(pending);
    pending = null;
  }, wait);
}

const subscribe = (fn: () => void): (() => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

/** Live cursors: a stable snapshot as long as nothing arrives (`useSyncExternalStore`). */
export const getPointers = (): LivePointer[] => pointers;

/** Cursors to display, re-evaluated at each received frame and at each expiry. */
export const useLivePointers = (): LivePointer[] => useSyncExternalStore(subscribe, getPointers, getPointers);
