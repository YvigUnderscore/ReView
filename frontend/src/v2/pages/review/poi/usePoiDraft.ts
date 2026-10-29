// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { MAX_COMMENT_ATTACHMENTS } from '../../../../lib/commentAttachments';
import type { Hotspot3D } from '../reviewTypes';
import { MAX_POI_POINTS } from './poiPoints';
import { t } from '../../../i18n';

/** Point of interest being drafted: its images are still local files. */
export interface PoiDraft {
  /** Stable identity of a composer row (the numbers, for their part, move at each removal). */
  key: string;
  position: string;
  normal: string;
  space?: 'object';
  text: string;
  files: File[];
}

export interface PoiDraftState {
  points: PoiDraft[];
  /** Point put forward: the composer row and the scene hotspot signal it together. */
  activeKey: string | null;
  setActiveKey: (key: string | null) => void;
  /** Places one more point, at the end: the rank gives its number. */
  add: (hotspot: Hotspot3D) => void;
  /** Moves the point of rank `index` elsewhere (hotspot dragged in the scene). */
  move: (index: number, hotspot: Hotspot3D) => void;
  remove: (key: string) => void;
  setText: (key: string, text: string) => void;
  addFiles: (key: string, files: File[]) => void;
  removeFile: (key: string, index: number) => void;
  clear: () => void;
}

const newKey = () => Math.random().toString(36).slice(2, 9);

/**
 * Points of interest of the composer: placed, numbered, movable and removable **as long as the comment
 * is not sent**. Sending carries them all in a single comment (see `useSubmitComment`), and `clear` resets
 * the list.
 *
 * There is no separate history: a point is removed with a cross, and the composer remains the single place
 * where one reads what is about to leave.
 */
export function usePoiDraft(): PoiDraftState {
  const [points, setPoints] = useState<PoiDraft[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);

  // The ceiling is read from the current list, outside the update function: the latter may be replayed
  // (strict mode), and a warning must not be.
  const count = points.length;
  const add = useCallback(
    (hotspot: Hotspot3D) => {
      if (count >= MAX_POI_POINTS) {
        toast.warning(t('poi.max', { count: MAX_POI_POINTS }));
        return;
      }
      const point: PoiDraft = { key: newKey(), ...hotspot, text: '', files: [] };
      setPoints((list) => [...list, point]);
      setActiveKey(point.key);
    },
    [count],
  );

  const move = useCallback((index: number, hotspot: Hotspot3D) => {
    setPoints((list) => list.map((p, i) => (i === index ? { ...p, ...hotspot } : p)));
  }, []);

  const remove = useCallback((key: string) => {
    setPoints((list) => list.filter((p) => p.key !== key));
    setActiveKey((active) => (active === key ? null : active));
  }, []);

  const patch = useCallback((key: string, apply: (point: PoiDraft) => PoiDraft) => {
    setPoints((list) => list.map((p) => (p.key === key ? apply(p) : p)));
  }, []);

  const setText = useCallback((key: string, text: string) => patch(key, (p) => ({ ...p, text })), [patch]);

  // The ceiling is that of a comment's attachments: the point images leave in the SAME list as those of
  // the composer (a single upload, that of batch 5).
  const addFiles = useCallback(
    (key: string, files: File[]) =>
      patch(key, (p) => ({ ...p, files: [...p.files, ...files].slice(0, MAX_COMMENT_ATTACHMENTS) })),
    [patch],
  );

  const removeFile = useCallback(
    (key: string, index: number) =>
      patch(key, (p) => ({ ...p, files: p.files.filter((_, i) => i !== index) })),
    [patch],
  );

  const clear = useCallback(() => {
    setPoints([]);
    setActiveKey(null);
  }, []);

  return useMemo(
    () => ({
      points,
      activeKey,
      setActiveKey,
      add,
      move,
      remove,
      setText,
      addFiles,
      removeFile,
      clear,
    }),
    [points, activeKey, add, move, remove, setText, addFiles, removeFile, clear],
  );
}
