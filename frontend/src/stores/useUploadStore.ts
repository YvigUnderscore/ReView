// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { create } from 'zustand';
import { toast } from 'sonner';
import { uploadMedia, inferMediaKind } from '../lib/uploadClient';
import { api } from '../lib/apiClient';
import type { MediaKind } from '../v2/types/api';

/**
 * Store global des uploads (Zustand).
 *
 * Permet la navigation libre pendant un upload : l'état vit ici, hors de l'arbre de
 * pages, et survit aux changements de route. Le flux délègue à `uploadClient`
 * (URL présignée → PUT direct MinIO → finalize), donc rien ne bloque le thread UI.
 *
 * Après finalize, si le média part en traitement (transcodage vidéo, conversion 3D…),
 * l'item passe en `processing` et le store **suit le statut** (poll léger) jusqu'à
 * READY/FAILED — la notification d'upload devient une notification de transcodage.
 */

export type UploadStatus = 'pending' | 'uploading' | 'finalizing' | 'processing' | 'done' | 'error';

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

const POLL_MS = 3000;
const POLL_MAX_MS = 20 * 60_000; // au-delà on abandonne le suivi (le worker a un souci)

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
        // Nom non conforme à la nomenclature du projet en mode « avertir » (38.C).
        if (res.namingWarning) toast.warning(`« ${file.name} » ne respecte pas la nomenclature du projet.`);
        if (res.status === 'PROCESSING') {
          // Traitement serveur (transcodage/conversion) : on suit jusqu'à READY.
          updateUpload(id, { status: 'processing', progress: 100, mediaObjectId: res.mediaObjectId });
          followProcessing(id, res.mediaObjectId, get);
        } else {
          updateUpload(id, { status: 'done', progress: 100, mediaObjectId: res.mediaObjectId });
        }
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
      (u) =>
        u.status === 'uploading' ||
        u.status === 'finalizing' ||
        u.status === 'processing' ||
        u.status === 'pending',
    ).length,
}));

/** Poll léger du statut média jusqu'à READY/FAILED (item retiré du store = arrêt). */
function followProcessing(id: string, mediaObjectId: number, get: () => UploadState) {
  const startedAt = Date.now();
  const tick = async () => {
    const item = get().uploads.find((u) => u.id === id);
    if (!item || item.status !== 'processing') return; // retiré ou terminé entre-temps
    if (Date.now() - startedAt > POLL_MAX_MS) {
      get().updateUpload(id, { status: 'error', error: 'Traitement trop long — voir la review' });
      return;
    }
    try {
      const { media } = await api.get<{ media: { status: string } }>(`/api/media/${mediaObjectId}`);
      if (media.status === 'READY') return get().updateUpload(id, { status: 'done' });
      if (media.status === 'FAILED')
        return get().updateUpload(id, { status: 'error', error: 'Traitement échoué (worker)' });
    } catch {
      // Erreur réseau transitoire : on retentera au prochain tick.
    }
    window.setTimeout(() => void tick(), POLL_MS);
  };
  window.setTimeout(() => void tick(), POLL_MS);
}
