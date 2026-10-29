// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useRef, useState } from 'react';
import { deleteKeys, type CameraAnimV2, type KeyRef, type TangentType } from './channels/model';
import { setBroken, setTangentType, setWeighted, type TangentTarget } from './channels/tangents';
import {
  copyKeys,
  loadClipboard,
  pasteKeys,
  persistClipboard,
  type CurveClipboard,
} from './channels/clipboard';

/** Ref read in the handlers only (never during render) — owned by `useCameraAnim`. */
interface Readable<T> {
  readonly current: T;
}

/**
 * Key selection of the curve editor and clipboard (Phase 27, Phase 40.E): multi-selection — the
 * last key is "primary" (tangent handles, camera-object) —, tangent mode applied in batch, batch
 * deletion, copy/paste in memory **and** in `localStorage` (from one media to another).
 *
 * The hook only owns the selection: the animation and its history stay with the caller, which
 * provides `animRef`, `timeRef` (playhead = paste point) and `commit` (mutation with an undo
 * snapshot). It is the attachment point for upcoming selections (per channel, per transform
 * box): they all go through `setSelection`.
 */
export function useCurveSelection(opts: {
  animRef: Readable<CameraAnimV2>;
  timeRef: Readable<number>;
  commit: (next: CameraAnimV2) => void;
}) {
  const { animRef, timeRef, commit } = opts;
  const [selection, setSelectionState] = useState<KeyRef[]>([]);
  const selectionRef = useRef(selection);
  useEffect(() => {
    selectionRef.current = selection;
  }, [selection]);

  const setSelection = useCallback((sels: KeyRef[]) => setSelectionState(sels), []);
  /** Clears the selection — after an animation replacement, the indices no longer designate anything. */
  const clearSelection = useCallback(() => setSelectionState([]), []);

  /**
   * Applies a tangent profile to the selected keys — on both sides by default, on one side only
   * if requested (the key then breaks by itself). The selection may span several channels, so this
   * is also the path for "apply to a whole set of curves".
   */
  const applyTangentType = useCallback(
    (type: TangentType, target: TangentTarget = 'both') => {
      const sels = selectionRef.current;
      if (!sels.length) return;
      commit(setTangentType(animRef.current, sels, type, target));
    },
    [animRef, commit],
  );

  /** Breaks (independent handles) or unifies the tangents of the selected keys. */
  const setSelectionBroken = useCallback(
    (broken: boolean) => {
      const sels = selectionRef.current;
      if (!sels.length) return;
      commit(setBroken(animRef.current, sels, broken));
    },
    [animRef, commit],
  );

  /** Enables/disables the tangent weighting of the selected keys (handle length). */
  const setSelectionWeighted = useCallback(
    (weighted: boolean) => {
      const sels = selectionRef.current;
      if (!sels.length) return;
      commit(setWeighted(animRef.current, sels, weighted));
    },
    [animRef, commit],
  );

  /** Deletes the selected keys (Delete). */
  const removeSelection = useCallback(() => {
    const sels = selectionRef.current;
    if (!sels.length) return;
    commit(deleteKeys(animRef.current, sels));
    setSelectionState([]);
  }, [animRef, commit]);

  // ── Copy/paste keys (40.E): in-memory clipboard + `localStorage` (cross-media). ──
  const clipboardRef = useRef<CurveClipboard | null>(loadClipboard());
  const [canPaste, setCanPaste] = useState(() => loadClipboard() != null);

  /** Copies the selected keys (value, mode, tangents) to the clipboard (Ctrl+C). */
  const copySelection = useCallback(() => {
    const clip = copyKeys(animRef.current, selectionRef.current);
    if (!clip) return;
    clipboardRef.current = clip;
    persistClipboard(clip);
    setCanPaste(true);
  }, [animRef]);

  /** Pastes the clipboard at the playhead and selects the pasted keys (Ctrl+V). */
  const paste = useCallback(() => {
    const clip = clipboardRef.current ?? loadClipboard();
    if (!clip) return;
    const { anim: next, selection: pasted } = pasteKeys(animRef.current, clip, timeRef.current);
    commit(next);
    setSelectionState(pasted);
  }, [animRef, timeRef, commit]);

  return {
    selection,
    setSelection,
    clearSelection,
    applyTangentType,
    setSelectionBroken,
    setSelectionWeighted,
    removeSelection,
    copySelection,
    paste,
    canPaste,
  };
}
