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
 * Les trois écritures d'une playlist — réordonner, retirer, renommer — avec leur annulation.
 *
 * Aucun des deux ne demandait de confirmation ni n'en donnait : « Retirer de la playlist » est
 * une ligne de menu contextuel, à un clic d'« Ouvrir dans la review », et rien ne se passait à
 * l'écran sinon la disparition de la ligne. Remonter une playlist de dailies de quarante plans
 * à la main est le genre de perte qui fait renoncer à l'écran.
 *
 * Pas de Ctrl+Z ici, et pour une raison précise : la playlist est un objet PARTAGÉ, la salle de
 * review live y lit son ordre, et l'écriture est déjà partie. Le cran est donc explicite, dans
 * le toast — et il n'annonce qu'un seul coup, celui qu'on vient de faire.
 */
export interface PlaylistEdits {
  reorder: (itemIds: number[]) => void;
  remove: (itemId: number) => void;
  /** `previous` : le nom d'avant, que l'annulation remet. */
  rename: (name: string, previous: string) => void;
  busy: boolean;
}

/**
 * Les items à poser pour retrouver un ordre donné en VERSIONS (fonction pure).
 *
 * Après un retrait puis un rajout, l'item porte un identifiant neuf : la version est la seule
 * identité qui survive au passage. Une version de l'ordre d'avant qui n'est plus dans la
 * playlist — quelqu'un d'autre l'a retirée pendant ce temps — est simplement sautée : on remet
 * ce qui existe encore plutôt que d'échouer en bloc sur un ordre devenu faux.
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

  /** Pose un ordre. Le serveur accepte une liste partielle (cf. `PlaylistContent`). */
  const writeOrder = async (itemIds: number[]): Promise<void> => {
    await api.patch(`/api/playlists/${playlistId}`, { itemIds });
    await invalidate();
  };

  /**
   * Remet une version retirée à sa place.
   *
   * Deux écritures, parce que le serveur n'en propose pas d'autre : on rajoute la version — elle
   * revient EN FIN de liste, avec un identifiant d'item neuf — puis on rejoue l'ordre d'avant
   * (`itemOrderFor`). Si la seconde échoue, la version est revenue quand même, au bout de la
   * liste : l'erreur le dit, plutôt que de faire silence sur un ordre à moitié rétabli.
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
    // Ordre d'AVANT le retrait, en versions : c'est ce qui permet de remettre la ligne à sa
    // place et non au bout de la liste.
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
