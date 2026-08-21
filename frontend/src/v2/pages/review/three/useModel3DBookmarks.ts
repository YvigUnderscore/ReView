// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import { t } from '../../../i18n';
import { isEditable } from '../../../lib/shortcuts';
import type { MediaResp, SplatEditsPatch, SplatPresentation } from '../reviewTypes';
import { useCameraPresentation } from '../camera/useCameraPresentation';
import { appendBookmark, bookmarkShortcutIndex, removeBookmarkAt, MAX_BOOKMARKS } from './cameraBookmarks';
import type { Model3DThreeState } from './useModel3DThree';

/**
 * Bookmarks caméra **partagés** du viewer 3D (39.D) : vues nommées persistées dans la présentation
 * (`splatPresentation.bookmarks`), rejouées/rappelables pour tous. Le gestionnaire enregistre la vue
 * courante ou en retire une ; tout spectateur les rappelle (clic sur la pastille du panneau Caméra,
 * ou **Alt+1** à **Alt+9**). Persistance via `useCameraPresentation` (fusion sur la présentation
 * existante, comme l'éclairage/l'animation).
 */
export function useModel3DBookmarks(
  model3d: Model3DThreeState,
  data: MediaResp,
  canManage: boolean,
  onSaved: (patch: SplatEditsPatch) => void,
) {
  const { captureCamera, restoreCamera } = model3d;
  const { busy, persist } = useCameraPresentation(data.media.id, onSaved);
  const bookmarks = data.splatPresentation?.bookmarks ?? [];

  const recall = useCallback(
    (index: number) => {
      const bm = (data.splatPresentation?.bookmarks ?? [])[index];
      if (bm) restoreCamera(bm.camera);
    },
    [data.splatPresentation, restoreCamera],
  );

  const add = useCallback(async () => {
    const camera = captureCamera();
    if (!camera) return;
    const base: SplatPresentation = { ...(data.splatPresentation ?? {}) };
    const next = appendBookmark(base.bookmarks ?? [], camera);
    if (!next) {
      toast.error(t('camera.maxBookmarks', { count: MAX_BOOKMARKS }));
      return;
    }
    await persist({ ...base, bookmarks: next });
  }, [captureCamera, data.splatPresentation, persist]);

  const remove = useCallback(
    async (index: number) => {
      const base: SplatPresentation = { ...(data.splatPresentation ?? {}) };
      const list = removeBookmarkAt(base.bookmarks ?? [], index);
      await persist({ ...base, bookmarks: list.length ? list : undefined });
    },
    [data.splatPresentation, persist],
  );

  // Alt+1 à Alt+9 : rappel d'un bookmark (hors saisie de texte, hors frappe déjà consommée).
  // Les chiffres nus restent à la bascule de mode du chrome — cf. `bookmarkShortcutIndex`.
  useEffect(() => {
    if (bookmarks.length === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isEditable(e.target)) return;
      const i = bookmarkShortcutIndex(e, bookmarks.length);
      if (i === null) return;
      e.preventDefault();
      recall(i);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [bookmarks.length, recall]);

  return {
    bookmarks,
    recall,
    busy,
    add: canManage ? add : undefined,
    remove: canManage ? remove : undefined,
    full: bookmarks.length >= MAX_BOOKMARKS,
  };
}

export type Model3DBookmarksState = ReturnType<typeof useModel3DBookmarks>;
