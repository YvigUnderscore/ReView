// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { api, getToken } from './apiClient';
import { t } from '../v2/i18n';
import { isAbortError, putWithProgress, runPool, throwIfAborted, withRetry } from './uploadTransfer';
import type { FileSequence } from './imageSequence';

/**
 * Envoi d'une séquence d'images : N fichiers, UN média.
 *
 * Le multipart résumable découpe un fichier en parts ; ici c'est l'inverse. Les trois
 * acquis du moteur d'envoi sont rejoués à l'échelle de la frame : parallélisme borné,
 * réessai avec re-signature, annulation réelle. La reprise, elle, ne coûte rien au client —
 * `init` renvoie les frames déjà présentes dans le stockage, qui sont simplement sautées.
 *
 * La progression est double, et c'est délibéré : « 342 / 1200 frames » dit à l'artiste où
 * il en est bien mieux qu'un pourcentage d'octets, mais les frames n'ont pas toutes la même
 * taille — on compte donc les octets pour la barre et les fichiers pour le texte.
 */

/** Frames envoyées de front. Même arbitrage que les parts d'un gros fichier. */
const FRAME_CONCURRENCY = 4;
/** URLs demandées par lot (le serveur borne à 64). */
const FRAME_URL_BATCH = 32;

export interface SequenceProgress {
  /** Octets transférés, frames déjà présentes comprises. */
  bytes: number;
  totalBytes: number;
  percent: number;
  files: number;
  totalFiles: number;
}

export interface SequenceUploadOptions {
  onProgress?: (progress: SequenceProgress) => void;
  signal?: AbortSignal;
  /** Cadence imposée ; sinon héritée du pipeline du plan côté serveur. */
  framerate?: number;
}

export interface SequenceUploadResult {
  mediaObjectId: number;
  status: string;
  frameCount: number;
  /** Numéros absents entre la première et la dernière frame arrivées. */
  missingFrames: number;
}

interface InitResponse {
  mediaObjectId: number;
  resumed: boolean;
  framerate: number;
  uploadedFrames: string[];
  namingWarning?: boolean;
}

interface CompleteResponse {
  media: { id: number; status: string };
  frameCount: number;
  missingFrames: number;
}

export async function uploadImageSequence(
  sequence: FileSequence,
  versionId: number,
  opts: SequenceUploadOptions = {},
): Promise<SequenceUploadResult> {
  if (!getToken()) throw new Error(t('uploads.error.notAuthenticated'));
  const { signal } = opts;
  throwIfAborted(signal);

  const init = await api.post<InitResponse>('/api/media/sequence/init', {
    versionId,
    pattern: sequence.pattern,
    frames: sequence.files.map((f) => ({ name: f.name, size: f.size })),
    ...(opts.framerate ? { framerate: opts.framerate } : {}),
  });

  try {
    await sendFrames(sequence, init, opts);
    throwIfAborted(signal);
    const done = await api.post<CompleteResponse>(`/api/media/sequence/${init.mediaObjectId}/complete`);
    return {
      mediaObjectId: init.mediaObjectId,
      status: done.media.status,
      frameCount: done.frameCount,
      missingFrames: done.missingFrames,
    };
  } catch (err) {
    // Abandon : les frames déjà déposées seraient facturées et invisibles — la route
    // d'annulation vide le préfixe et supprime le média resté en UPLOADING.
    if (isAbortError(err) || signal?.aborted) {
      void api.post(`/api/media/multipart/${init.mediaObjectId}/abort`).catch(() => undefined);
    }
    throw err;
  }
}

/** Envoie les frames manquantes ; celles déjà en place comptent dans la progression. */
async function sendFrames(
  sequence: FileSequence,
  init: InitResponse,
  opts: SequenceUploadOptions,
): Promise<void> {
  const { signal, onProgress } = opts;
  const already = new Set(init.uploadedFrames);
  const totalBytes = sequence.totalSize;
  const totalFiles = sequence.files.length;
  const missing = sequence.files.filter((f) => !already.has(f.name));

  let sent = sequence.files.filter((f) => already.has(f.name)).reduce((acc, f) => acc + f.size, 0);
  let files = totalFiles - missing.length;
  const inFlight = new Map<string, number>();
  const emit = (): void => {
    let extra = 0;
    for (const loaded of inFlight.values()) extra += loaded;
    onProgress?.({
      bytes: sent + extra,
      totalBytes,
      percent: totalBytes > 0 ? Math.min(99, Math.round(((sent + extra) / totalBytes) * 100)) : 0,
      files,
      totalFiles,
    });
  };
  emit();

  for (let i = 0; i < missing.length; i += FRAME_URL_BATCH) {
    throwIfAborted(signal);
    const batch = missing.slice(i, i + FRAME_URL_BATCH);
    const urls = await frameUrls(
      init.mediaObjectId,
      batch.map((f) => f.name),
    );
    await runPool(batch, FRAME_CONCURRENCY, async (file) => {
      await sendFrame(init.mediaObjectId, file, urls.get(file.name) ?? '', inFlight, emit, signal);
      sent += file.size;
      files += 1;
      emit();
    });
  }
}

async function frameUrls(mediaObjectId: number, names: string[]): Promise<Map<string, string>> {
  const { urls } = await api.post<{ urls: { name: string; url: string }[] }>(
    `/api/media/sequence/${mediaObjectId}/urls`,
    { names },
  );
  return new Map(urls.map((u) => [u.name, u.url]));
}

/** Une frame, avec réessai : chaque nouvelle tentative repart d'une signature fraîche. */
async function sendFrame(
  mediaObjectId: number,
  file: File,
  url: string,
  inFlight: Map<string, number>,
  emit: () => void,
  signal?: AbortSignal,
): Promise<void> {
  try {
    await withRetry(async (tryIndex) => {
      const target =
        tryIndex === 0 ? url : ((await frameUrls(mediaObjectId, [file.name])).get(file.name) ?? url);
      inFlight.set(file.name, 0);
      // Pas de Content-Type : le serveur l'arrête lui-même à la finalisation, et la
      // signature S3 ne le couvre pas.
      await putWithProgress(
        target,
        file,
        null,
        (loaded) => {
          inFlight.set(file.name, loaded);
          emit();
        },
        signal,
      );
    }, signal);
  } finally {
    inFlight.delete(file.name);
  }
}
