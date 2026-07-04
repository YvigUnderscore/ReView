import { create } from 'zustand';
import { uploadMedia, inferMediaKind } from '../lib/uploadClient';
import type { MediaKind } from '../v2/types/api';

/**
 * Store global des uploads (Zustand).
 *
 * Permet la navigation libre pendant un upload : l'état vit ici, hors de l'arbre de
 * pages, et survit aux changements de route. Le flux délègue à `uploadClient`
 * (URL présignée → PUT direct MinIO → finalize), donc rien ne bloque le thread UI.
 */

export type UploadStatus = 'pending' | 'uploading' | 'finalizing' | 'done' | 'error';

export interface UploadItem {
  id: string;
  filename: string;
  versionId: number;
  kind: MediaKind;
  progress: number; // 0–100
  status: UploadStatus;
  mediaObjectId?: number;
  error?: string;
}

interface UploadState {
  uploads: UploadItem[];
  /** Démarre un upload non-bloquant et l'ajoute au store. Retourne l'id local. */
  enqueue: (file: File, versionId: number, kind?: MediaKind) => string;
  updateUpload: (id: string, patch: Partial<UploadItem>) => void;
  removeUpload: (id: string) => void;
  clearCompleted: () => void;
  /** Nombre d'uploads en cours (pour badges/indicateurs). */
  activeCount: () => number;
}

export const useUploadStore = create<UploadState>((set, get) => ({
  uploads: [],

  enqueue: (file, versionId, kind) => {
    const id = crypto.randomUUID();
    const item: UploadItem = {
      id,
      filename: file.name,
      versionId,
      kind: kind ?? inferMediaKind(file),
      progress: 0,
      status: 'pending',
    };
    set((s) => ({ uploads: [...s.uploads, item] }));

    void (async () => {
      const { updateUpload } = get();
      try {
        updateUpload(id, { status: 'uploading' });
        const res = await uploadMedia(file, versionId, {
          kind: item.kind,
          onProgress: (pct) =>
            updateUpload(id, { progress: pct, status: pct >= 100 ? 'finalizing' : 'uploading' }),
        });
        updateUpload(id, { status: 'done', progress: 100, mediaObjectId: res.mediaObjectId });
      } catch (err) {
        updateUpload(id, { status: 'error', error: err instanceof Error ? err.message : 'Échec' });
      }
    })();

    return id;
  },

  updateUpload: (id, patch) =>
    set((s) => ({ uploads: s.uploads.map((u) => (u.id === id ? { ...u, ...patch } : u)) })),
  removeUpload: (id) => set((s) => ({ uploads: s.uploads.filter((u) => u.id !== id) })),
  clearCompleted: () => set((s) => ({ uploads: s.uploads.filter((u) => u.status !== 'done') })),
  activeCount: () =>
    get().uploads.filter(
      (u) => u.status === 'uploading' || u.status === 'finalizing' || u.status === 'pending',
    ).length,
}));
