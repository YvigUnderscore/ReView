// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { qk } from '../../lib/query';
import { t } from '../../i18n';
import { BoardConflictError, boardBase, loadBoard, persistBoard, type BoardScope } from './boardApi';
import { sceneSignature } from './boardSignature';
import type { BoardFiles } from './boardFiles';

/**
 * Editing state of a board: loading, image uploads, debounced autosave and
 * concurrent-edit detection.
 *
 * Two invariants carry everything else:
 *  - `baseRef` is the `updatedAt` on which the displayed scene was loaded. Each
 *    save presents it to the server, which refuses with a 409 if someone has written since,
 *    instead of the silent overwrite that used to happen.
 *  - the board **never reloads on its own** (`refetchOnWindowFocus` disabled):
 *    Excalidraw reads `initialData` only at mount, and an invisible reload would replace
 *    the reference without replacing the scene, reopening exactly the overwrite.
 */

/** `sig`: fingerprint of the scene (see `boardSignature`), the only reliable basis for comparison. */
type Snapshot = { elements: readonly unknown[]; files: BoardFiles; sig: string };

export type BoardEditor = {
  /** Scene to pass to Excalidraw, `null` until the board is loaded. */
  initial: { elements: unknown[]; files: BoardFiles } | null;
  /** Changes on each requested reload: used as a `key` to remount the editor. */
  mountKey: number;
  loadError: string | null;
  saveError: string | null;
  saved: boolean;
  /** Non-null when the server refused the save: the user must decide. */
  conflict: boolean;
  onChange: (elements: readonly unknown[], appState: unknown, files: BoardFiles) => void;
  /** Takes the server's version: unsaved local changes are lost. */
  reload: () => void;
  /** Re-saves the local version over the server's one. */
  overwrite: () => void;
};

const SAVE_DEBOUNCE_MS = 1200;

export function useBoardDocument(scope: BoardScope, targetId: number): BoardEditor {
  const base = boardBase(scope, targetId);
  const baseRef = useRef<string | null>(null);
  /** Fingerprint of the scene as it is currently saved on the server. */
  const savedSigRef = useRef<string | null>(null);
  const storedRef = useRef<Set<string>>(new Set());
  const pendingRef = useRef<Snapshot | null>(null);
  const runningRef = useRef(false);
  const conflictRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [mountKey, setMountKey] = useState(0);
  const [saved, setSaved] = useState(true);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);

  const boardQ = useQuery({
    queryKey: qk.board(scope, targetId),
    queryFn: async () => {
      const loaded = await loadBoard(base);
      // Edit reference and inventory of already stored images: they accompany
      // exactly the scene the editor is about to mount.
      baseRef.current = loaded.updatedAt;
      storedRef.current = loaded.storedIds;
      // Starting point of the comparison: without it, the very first `onChange`, the one
      // Excalidraw emits at mount without any user action, would count as an
      // edit and trigger a save each time a board is opened.
      savedSigRef.current = sceneSignature(loaded.elements, loaded.files);
      return loaded;
    },
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const schedule = (delay: number): void => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void run(), delay);
  };

  const run = async (): Promise<void> => {
    if (conflictRef.current) return;
    // A save is in flight: we come back afterwards, with the most recent state.
    if (runningRef.current) {
      schedule(SAVE_DEBOUNCE_MS);
      return;
    }
    const snapshot = pendingRef.current;
    if (!snapshot) return;
    runningRef.current = true;
    try {
      baseRef.current = await persistBoard(base, snapshot, storedRef.current, baseRef.current);
      savedSigRef.current = snapshot.sig;
      // Compare by FINGERPRINT, never by object identity: `onChange` builds a new
      // object on every call, so `pendingRef.current === snapshot` was
      // always false: the snapshot was never purged and the save kept re-running
      // endlessly on an unchanged document.
      if (pendingRef.current?.sig === snapshot.sig) {
        pendingRef.current = null;
        setSaved(true);
      }
      setSaveError(null);
    } catch (err) {
      if (err instanceof BoardConflictError) {
        conflictRef.current = true;
        baseRef.current = err.serverUpdatedAt;
        setConflict(true);
      } else {
        setSaveError(err instanceof Error ? err.message : t('common.error.generic'));
      }
    } finally {
      runningRef.current = false;
    }
  };

  const onChange = (elements: readonly unknown[], _appState: unknown, files: BoardFiles): void => {
    const sig = sceneSignature(elements, files);
    // Excalidraw calls `onChange` for a cursor move, a scroll, a
    // selection, or simply because this component re-rendered. Without this filter, each
    // of these callbacks re-armed a save: a board left open and **untouched** rewrote its
    // row in the database every ~1.2 s, for each open studio tab.
    if (sig === savedSigRef.current) {
      if (pendingRef.current) {
        pendingRef.current = null;
        setSaved(true);
      }
      return;
    }
    pendingRef.current = { elements, files, sig };
    setSaved(false);
     if (conflictRef.current) return; // the user must decide first
    schedule(SAVE_DEBOUNCE_MS);
  };

  const reload = (): void => {
    if (timerRef.current) clearTimeout(timerRef.current);
    pendingRef.current = null;
    conflictRef.current = false;
    setConflict(false);
    setSaveError(null);
    setSaved(true);
    void boardQ.refetch().then(() => setMountKey((k) => k + 1));
  };

  const overwrite = (): void => {
    conflictRef.current = false;
    setConflict(false);
    // `baseRef` already carries the timestamp returned by the 409: the rewrite is accepted.
    schedule(0);
  };

  const data = boardQ.data;
  return {
    initial: data
      ? { elements: data.elements, files: data.files }
      : boardQ.isError
        ? { elements: [], files: {} }
        : null,
    mountKey,
    loadError: boardQ.error?.message ?? null,
    saveError,
    saved,
    conflict,
    onChange,
    reload,
    overwrite,
  };
}
