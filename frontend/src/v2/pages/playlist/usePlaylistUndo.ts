// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { useUndoToast } from '../../lib/useUndoToast';
import type { PlaylistDetail, PlaylistItemEntry } from '../../types/api';
import { useT } from '../../i18n';

/**
 * The three writes of a playlist (reorder, remove, rename), with their undo.
 *
 * Neither one asked for a confirmation nor offered one: "Remove from playlist" is a context-menu
 * row, one click away from "Open in review", and the screen showed nothing but the row
 * disappearing. Rebuilding a forty-shot dailies playlist by hand is the kind of loss that makes
 * one give up on the screen.
 *
 * No Ctrl+Z here, for a precise reason: the playlist is a SHARED object, the live review room reads
 * its order from it, and the write has already gone out. The undo step is therefore explicit, in
 * the toast, and it announces only one step: the one just taken.
 */
export interface PlaylistEdits {
  reorder: (itemIds: number[]) => void;
  remove: (itemId: number) => void;
  /** `previous`: the name from before, which the undo puts back. */
  rename: (name: string, previous: string) => void;
  busy: boolean;
}

/**
 * The items to write in order to restore a given order in VERSIONS (pure function).
 *
 * After a removal followed by a re-addition, the item carries a new identifier: the version is the
 * only identity that survives the round trip. A version of the earlier order that is no longer in
 * the playlist (someone else removed it in the meantime) is simply skipped: what still exists is
 * put back, rather than failing as a whole on an order that has become false.
 */
export function itemOrderFor(
  items: readonly { id: number; version: { id: number } }[],
  orderByVersion: readonly number[],
): number[] {
  const itemOf = new Map(items.map((item) => [item.version.id, item.id]));
  return orderByVersion.map((id) => itemOf.get(id)).filter((id): id is number => id !== undefined);
}

export function usePlaylistUndo(
  playlistId: number,
  projectId: number,
  items: readonly PlaylistItemEntry[],
): PlaylistEdits {
  const t = useT();
  const qc = useQueryClient();
  const { done } = useUndoToast();
  const [busy, setBusy] = useState(false);

  const invalidate = async (): Promise<void> => {
    await qc.invalidateQueries({ queryKey: qk.playlist(playlistId) });
    void qc.invalidateQueries({ queryKey: qk.playlists(projectId) });
  };

  /** Writes an order. The server accepts a partial list (cf. `PlaylistContent`). */
  const writeOrder = async (itemIds: number[]): Promise<void> => {
    await api.patch(`/api/playlists/${playlistId}`, { itemIds });
    await invalidate();
  };

  /**
   * Puts a removed version back in its place.
   *
   * Two writes, because the server offers no other: the version is added back, where it comes back
   * AT THE END of the list with a new item identifier, then the earlier order is replayed
   * (`itemOrderFor`). If the second fails, the version is back anyway, at the end of the list: the
   * error says so, rather than staying silent about an order only half restored.
   */
  const restore = async (versionId: number, orderByVersion: number[]): Promise<void> => {
    await api.post(`/api/playlists/${playlistId}/items`, { versionIds: [versionId] });
    const { playlist } = await api.get<{ playlist: PlaylistDetail }>(`/api/playlists/${playlistId}`);
    await writeOrder(itemOrderFor(playlist.items, orderByVersion));
  };

  const fail = (err: unknown) => toast.error(err instanceof Error ? err.message : t('common.error.generic'));

  const reorder = (itemIds: number[]): void => {
    const previous = items.map((item) => item.id);
    setBusy(true);
    void writeOrder(itemIds)
      .then(() => done(t('playlist.reordered'), () => writeOrder(previous)))
      .catch(fail)
      .finally(() => setBusy(false));
  };

  const remove = (itemId: number): void => {
    const removed = items.find((item) => item.id === itemId);
    if (!removed) return;
    // The order BEFORE the removal, in versions: this is what puts the row back in its place,
    // and not at the end of the list.
    const orderByVersion = items.map((item) => item.version.id);
    setBusy(true);
    void api
      .del(`/api/playlists/${playlistId}/items/${itemId}`)
      .then(invalidate)
      .then(() => done(t('playlist.removed'), () => restore(removed.version.id, orderByVersion)))
      .catch(fail)
      .finally(() => setBusy(false));
  };

  const writeName = async (name: string): Promise<void> => {
    await api.patch(`/api/playlists/${playlistId}`, { name });
    await invalidate();
  };

  const rename = (name: string, previous: string): void => {
    setBusy(true);
    void writeName(name)
      .then(() => done(t('common.saved'), () => writeName(previous)))
      .catch(fail)
      .finally(() => setBusy(false));
  };

  return { reorder, remove, rename, busy };
}
