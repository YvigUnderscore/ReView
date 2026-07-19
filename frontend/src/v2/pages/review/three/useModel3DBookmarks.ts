import { useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import type { MediaResp, SplatCamera, SplatEditsPatch, SplatPresentation } from '../reviewTypes';
import { useCameraPresentation } from '../camera/useCameraPresentation';
import { appendBookmark, removeBookmarkAt, MAX_BOOKMARKS } from './cameraBookmarks';
import type { Model3DThreeState } from './useModel3DThree';

/** Ignore le raccourci quand l'utilisateur saisit du texte (champ de commentaire, etc.). */
function isTypingTarget(el: EventTarget | null): boolean {
  const t = el as HTMLElement | null;
  if (!t) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || t.isContentEditable;
}

/**
 * Bookmarks caméra **partagés** du viewer 3D (39.D) : vues nommées persistées dans la présentation
 * (`splatPresentation.bookmarks`), rejouées/rappelables pour tous. Le gestionnaire enregistre la vue
 * courante ou en retire une ; tout spectateur les rappelle (clic ou touches **1-9**). Persistance via
 * `useCameraPresentation` (fusion sur la présentation existante, comme l'éclairage/l'animation).
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
    const camera = captureCamera() as SplatCamera | undefined;
    if (!camera) return;
    const base: SplatPresentation = { ...(data.splatPresentation ?? {}) };
    const next = appendBookmark(base.bookmarks ?? [], camera);
    if (!next) {
      toast.error(`Maximum ${MAX_BOOKMARKS} bookmarks`);
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

  // Raccourcis 1-9 : rappel d'un bookmark (hors saisie de texte, sans modificateur).
  useEffect(() => {
    if (bookmarks.length === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return;
      if (e.key >= '1' && e.key <= '9') {
        const i = Number(e.key) - 1;
        if (i < bookmarks.length) {
          recall(i);
          e.preventDefault();
        }
      }
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
