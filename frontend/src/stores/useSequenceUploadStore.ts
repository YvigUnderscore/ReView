// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { create } from 'zustand';
import { toast } from 'sonner';
import { t } from '../v2/i18n';
import { api } from '../lib/apiClient';
import { detectSequences, type FileSequence } from '../lib/imageSequence';
import { uploadImageSequence } from '../lib/sequenceUpload';
import { useUploadStore } from './useUploadStore';

/**
 * Dépôt d'un lot de fichiers : proposer le regroupement, puis l'envoyer.
 *
 * Ce store est le point d'entrée de **tout** dépôt destiné à une version. Il reconnaît les
 * séquences d'images, ouvre la proposition, et n'envoie rien tant que l'utilisateur n'a pas
 * tranché — un regroupement imposé en silence produirait un média dont personne n'a voulu.
 * Quand aucun motif n'est reconnu, il s'efface : les fichiers repartent dans la file
 * ordinaire (`useUploadStore`), sans détour ni dialogue.
 *
 * Les séquences ont leur propre file parce qu'elles n'ont ni la même granularité
 * (« 342 / 1200 frames ») ni le même coût : une seule à la fois, chacune parallélisant déjà
 * ses frames.
 */

export type SequenceUploadStatus = 'pending' | 'uploading' | 'processing' | 'done' | 'error';

export interface SequenceUploadItem {
  id: string;
  /** Motif de nommage, affiché tel quel : c'est ainsi que l'artiste nomme son plan. */
  pattern: string;
  versionId: number;
  totalFrames: number;
  framesDone: number;
  progress: number;
  status: SequenceUploadStatus;
  mediaObjectId?: number;
  error?: string;
}

/** Dépôt en attente de décision : ce que la lecture des noms a reconnu. */
export interface SequenceProposal {
  versionId: number;
  sequences: FileSequence[];
  singles: File[];
}

const POLL_MS = 3000;
/** Au-delà, on cesse de suivre : l'assemblage a un souci que le poll ne dira pas. */
const POLL_MAX_MS = 60 * 60_000;

/** Une séquence à la fois : chacune sature déjà le lien avec ses quatre frames de front. */
const MAX_CONCURRENT_SEQUENCES = 1;

/** Les fichiers restent hors du store : un `File` n'a rien à faire dans l'état rendu. */
const queued = new Map<string, { sequence: FileSequence; versionId: number }>();
const controllers = new Map<string, AbortController>();

interface SequenceUploadState {
  proposal: SequenceProposal | null;
  uploads: SequenceUploadItem[];
  /** Point d'entrée d'un dépôt : reconnaît, propose, ou délègue à la file ordinaire. */
  proposeDrop: (files: File[], versionId: number) => void;
  /** Envoie en séquences celles qui sont retenues, en fichiers tout le reste. */
  acceptProposal: (grouped: FileSequence[]) => void;
  cancelProposal: () => void;
  removeUpload: (id: string) => void;
  clearCompleted: () => void;
}

const enqueueFiles = (files: File[], versionId: number): void => {
  const { enqueue } = useUploadStore.getState();
  for (const file of files) enqueue(file, versionId);
};

export const useSequenceUploadStore = create<SequenceUploadState>((set, get) => ({
  proposal: null,
  uploads: [],

  proposeDrop: (files, versionId) => {
    if (files.length === 0) return;
    const { sequences, singles } = detectSequences(files);
    if (sequences.length === 0) {
      enqueueFiles(files, versionId);
      return;
    }
    set({ proposal: { versionId, sequences, singles } });
  },

  acceptProposal: (grouped) => {
    const proposal = get().proposal;
    set({ proposal: null });
    if (!proposal) return;
    const kept = new Set(grouped.map((s) => s.pattern));
    const loose = proposal.sequences.filter((s) => !kept.has(s.pattern)).flatMap((s) => s.files);
    enqueueFiles([...proposal.singles, ...loose], proposal.versionId);
    for (const sequence of grouped) {
      const id = crypto.randomUUID();
      queued.set(id, { sequence, versionId: proposal.versionId });
      set((s) => ({
        uploads: [
          ...s.uploads,
          {
            id,
            pattern: sequence.pattern,
            versionId: proposal.versionId,
            totalFrames: sequence.frameCount,
            framesDone: 0,
            progress: 0,
            status: 'pending' as const,
          },
        ],
      }));
    }
    pump(set, get);
  },

  cancelProposal: () => set({ proposal: null }),

  removeUpload: (id) => {
    controllers.get(id)?.abort();
    controllers.delete(id);
    queued.delete(id);
    set((s) => ({ uploads: s.uploads.filter((u) => u.id !== id) }));
    pump(set, get);
  },

  clearCompleted: () => set((s) => ({ uploads: s.uploads.filter((u) => u.status !== 'done') })),
}));

type Setter = (fn: (state: SequenceUploadState) => Partial<SequenceUploadState>) => void;

const patch = (set: Setter, id: string, changes: Partial<SequenceUploadItem>): void =>
  set((s) => ({ uploads: s.uploads.map((u) => (u.id === id ? { ...u, ...changes } : u)) }));

/** Démarre les envois en attente tant qu'il reste un créneau. */
function pump(set: Setter, get: () => SequenceUploadState): void {
  const { uploads } = get();
  let running = uploads.filter((u) => u.status === 'uploading').length;
  for (const item of uploads) {
    if (running >= MAX_CONCURRENT_SEQUENCES) return;
    if (item.status !== 'pending') continue;
    const job = queued.get(item.id);
    if (!job) continue;
    queued.delete(item.id);
    running += 1;
    void startSequence(item.id, job, set, get);
  }
}

async function startSequence(
  id: string,
  job: { sequence: FileSequence; versionId: number },
  set: Setter,
  get: () => SequenceUploadState,
): Promise<void> {
  const controller = new AbortController();
  controllers.set(id, controller);
  patch(set, id, { status: 'uploading' });
  try {
    const res = await uploadImageSequence(job.sequence, job.versionId, {
      signal: controller.signal,
      onProgress: (p) => patch(set, id, { progress: p.percent, framesDone: p.files }),
    });
    // Une livraison à trous n'est pas une erreur, mais elle se dit : c'est le genre
    // d'oubli qu'un artiste veut connaître avant la review, pas pendant.
    if (res.missingFrames > 0) toast.warning(t('imageSequence.gaps', { count: res.missingFrames }));
    patch(set, id, {
      status: 'processing',
      progress: 100,
      framesDone: res.frameCount,
      mediaObjectId: res.mediaObjectId,
    });
    followProcessing(id, res.mediaObjectId, set, get);
  } catch (err) {
    if (!controller.signal.aborted) {
      patch(set, id, {
        status: 'error',
        error: err instanceof Error ? err.message : t('uploads.error.generic'),
      });
    }
  } finally {
    controllers.delete(id);
    pump(set, get);
  }
}

/** Poll léger jusqu'à READY/FAILED — l'assemblage d'un plan long prend des minutes. */
function followProcessing(
  id: string,
  mediaObjectId: number,
  set: Setter,
  get: () => SequenceUploadState,
): void {
  const startedAt = Date.now();
  const tick = async (): Promise<void> => {
    const item = get().uploads.find((u) => u.id === id);
    if (!item || item.status !== 'processing') return;
    if (Date.now() - startedAt > POLL_MAX_MS) {
      patch(set, id, { status: 'error', error: t('uploads.error.processingTimeout') });
      return;
    }
    try {
      const { media } = await api.get<{ media: { status: string } }>(`/api/media/${mediaObjectId}`);
      if (media.status === 'READY') return patch(set, id, { status: 'done' });
      if (media.status === 'FAILED')
        return patch(set, id, { status: 'error', error: t('uploads.error.processingFailed') });
    } catch {
      // Coupure passagère : on retentera au prochain tick.
    }
    window.setTimeout(() => void tick(), POLL_MS);
  };
  window.setTimeout(() => void tick(), POLL_MS);
}
