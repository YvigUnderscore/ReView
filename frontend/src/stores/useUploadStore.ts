// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { t } from '../v2/i18n';
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
 * **File bornée (vague 2)** : déposer trente plans lançait trente transferts de front,
 * qui se disputaient la bande passante et faisaient expirer les signatures des derniers.
 * Trois fichiers montent à la fois, les suivants attendent leur créneau en `pending`.
 * Chaque transfert porte un `AbortController` : retirer une ligne coupe réellement la
 * requête en vol et abandonne le multipart côté serveur.
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

/** Transferts simultanés. Au-delà, les connexions se gênent plus qu'elles n'aident. */
const MAX_CONCURRENT_UPLOADS = 3;

/** Statuts qui consomment un créneau de transfert (le traitement serveur, lui, est gratuit). */
const isTransferring = (s: UploadStatus): boolean => s === 'uploading' || s === 'finalizing';

/** Fichiers en attente de créneau — hors du store : un `File` n'a rien à faire dans l'état rendu. */
const queued = new Map<string, { file: File; versionId: number; kind: MediaKind }>();
/** Annulation des transferts en vol, par identifiant d'item. */
const controllers = new Map<string, AbortController>();

interface UploadState {
  uploads: UploadItem[];
  /** Met un fichier en file (démarrage immédiat si un créneau est libre). Retourne l'id local. */
  enqueue: (file: File, versionId: number, kind?: MediaKind) => string;
  updateUpload: (id: string, patch: Partial<UploadItem>) => void;
  /** Retire la ligne — et annule vraiment le transfert s'il est en cours. */
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
    queued.set(id, { file, versionId, kind: item.kind });
    set((s) => ({ uploads: [...s.uploads, item] }));
    pump(get);
    return id;
  },

  updateUpload: (id, patch) =>
    set((s) => ({ uploads: s.uploads.map((u) => (u.id === id ? { ...u, ...patch } : u)) })),

  removeUpload: (id) => {
    controllers.get(id)?.abort();
    controllers.delete(id);
    queued.delete(id);
    set((s) => ({ uploads: s.uploads.filter((u) => u.id !== id) }));
    pump(get);
  },

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

/**
 * Démarre les transferts en attente tant qu'il reste un créneau. Le compte des transferts
 * actifs se lit dans l'état plutôt que dans un compteur parallèle : vider le store (tests,
 * déconnexion) ne peut donc pas laisser la file bloquée sur un créneau fantôme.
 */
function pump(get: () => UploadState): void {
  const { uploads } = get();
  let running = uploads.filter((u) => isTransferring(u.status)).length;
  for (const item of uploads) {
    if (running >= MAX_CONCURRENT_UPLOADS) return;
    if (item.status !== 'pending') continue;
    const job = queued.get(item.id);
    if (!job) continue;
    queued.delete(item.id);
    running += 1;
    void startUpload(item.id, job, get);
  }
}

async function startUpload(
  id: string,
  job: { file: File; versionId: number; kind: MediaKind },
  get: () => UploadState,
): Promise<void> {
  const { updateUpload } = get();
  const controller = new AbortController();
  controllers.set(id, controller);
  updateUpload(id, { status: 'uploading' });
  try {
    const res = await uploadMedia(job.file, job.versionId, {
      kind: job.kind,
      signal: controller.signal,
      onProgress: (pct) =>
        updateUpload(id, { progress: pct, status: pct >= 100 ? 'finalizing' : 'uploading' }),
    });
    // Nom non conforme à la nomenclature du projet en mode « avertir » (38.C).
    if (res.namingWarning) toast.warning(t('naming.warningFile', { name: job.file.name }));
    if (res.status === 'PROCESSING') {
      // Traitement serveur (transcodage/conversion) : on suit jusqu'à READY.
      updateUpload(id, { status: 'processing', progress: 100, mediaObjectId: res.mediaObjectId });
      followProcessing(id, res.mediaObjectId, get);
    } else {
      updateUpload(id, { status: 'done', progress: 100, mediaObjectId: res.mediaObjectId });
    }
  } catch (err) {
    // Annulation demandée : la ligne a déjà disparu, il n'y a pas d'échec à signaler.
    if (!controller.signal.aborted) {
      updateUpload(id, {
        status: 'error',
        error: err instanceof Error ? err.message : t('uploads.error.generic'),
      });
    }
  } finally {
    controllers.delete(id);
    pump(get);
  }
}

/** Poll léger du statut média jusqu'à READY/FAILED (item retiré du store = arrêt). */
function followProcessing(id: string, mediaObjectId: number, get: () => UploadState) {
  const startedAt = Date.now();
  const tick = async () => {
    const item = get().uploads.find((u) => u.id === id);
    if (!item || item.status !== 'processing') return; // retiré ou terminé entre-temps
    if (Date.now() - startedAt > POLL_MAX_MS) {
      get().updateUpload(id, { status: 'error', error: t('uploads.error.processingTimeout') });
      return;
    }
    try {
      const { media } = await api.get<{ media: { status: string } }>(`/api/media/${mediaObjectId}`);
      if (media.status === 'READY') return get().updateUpload(id, { status: 'done' });
      if (media.status === 'FAILED')
        return get().updateUpload(id, { status: 'error', error: t('uploads.error.processingFailed') });
    } catch {
      // Erreur réseau transitoire : on retentera au prochain tick.
    }
    window.setTimeout(() => void tick(), POLL_MS);
  };
  window.setTimeout(() => void tick(), POLL_MS);
}
