// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { api, getToken } from './apiClient';
import { t } from '../v2/i18n';
import { sha256OfFile } from './hashFile';
import { isAbortError, putWithProgress, runPool, throwIfAborted, withRetry } from './uploadTransfer';
import type { MediaKind } from '../v2/types/api';

// `.usd` (conteneur générique, binaire ou ASCII) manquait : il n'arrivait en MODEL_3D que par
// le repli de `inferMediaKind`, donc jamais depuis un filtre de sélecteur de fichiers (45.F).
const MODEL_EXT = [
  '.glb',
  '.gltf',
  '.fbx',
  '.usd',
  '.usdz',
  '.usdc',
  '.usda',
  '.obj',
  '.dae',
  '.stl',
  '.zip',
];
// Gaussian Splat (viewer Spark/SparkJS) — cf. detectSplat côté backend.
const SPLAT_EXT = ['.ply', '.splat', '.spz', '.ksplat', '.sog', '.sogs'];

/** Au-delà de ce seuil : multipart résumable (37.A). La taille de part vient du serveur. */
const MULTIPART_THRESHOLD = 16 * 1024 * 1024;
/** URLs de parts demandées par lots (bornées côté serveur à 64). */
const PART_URL_BATCH = 32;
/**
 * Parts envoyées de front. S3 en accepte davantage, mais quatre connexions saturent déjà
 * un lien de studio tout en laissant l'interface (et les autres onglets) respirer.
 */
const PART_CONCURRENCY = 4;

/** Déduit le MediaKind d'un fichier à partir de son type MIME / extension. */
export function inferMediaKind(file: File): MediaKind {
  const name = file.name.toLowerCase();
  const ext = name.slice(name.lastIndexOf('.'));
  if (SPLAT_EXT.includes(ext)) return 'SPLAT';
  if (MODEL_EXT.includes(ext)) return 'MODEL_3D';
  if (file.type.startsWith('video/')) return 'VIDEO';
  if (file.type.startsWith('image/')) return 'IMAGE';
  return 'MODEL_3D';
}

export interface UploadResult {
  mediaObjectId: number;
  status: string;
  /** Contenu identique déjà présent : aucun octet transféré (37.B). */
  deduplicated?: boolean;
  /** Nom non conforme à la nomenclature du projet en mode « avertir » (38.C). */
  namingWarning?: boolean;
}

interface MultipartInit {
  mediaObjectId: number;
  partSize: number;
  uploadedParts: { partNumber: number; etag: string }[];
  deduplicated?: boolean;
  resumed?: boolean;
  namingWarning?: boolean;
}

export interface UploadOptions {
  kind?: MediaKind;
  onProgress?: (pct: number) => void;
  /** Annulation : coupe les requêtes en vol et abandonne le multipart côté serveur. */
  signal?: AbortSignal;
}

/** N'appelle l'appelant que lorsque le pourcentage change vraiment (4 parts = 4× d'événements). */
function throttlePercent(onProgress?: (pct: number) => void): (pct: number) => void {
  let last = -1;
  return (pct) => {
    if (pct === last) return;
    last = pct;
    onProgress?.(pct);
  };
}

/**
 * Flux d'upload v2 (37.A/37.B) :
 *  1) sha256 du fichier (checksum bout-en-bout + dédup), calculé dans un worker ;
 *  2) petits fichiers → PUT présigné direct ; gros → multipart résumable, parts envoyées
 *     en parallèle avec réessai (la reprise saute les parts déjà reçues, connues du
 *     serveur via ListParts) ;
 *  3) finalize : validation magic bytes + traitement.
 *
 * `opts.signal` annule à toute étape : la requête en vol est coupée, et l'upload
 * multipart laissé derrière est explicitement abandonné côté serveur.
 */
export async function uploadMedia(
  file: File,
  versionId: number,
  opts: UploadOptions = {},
): Promise<UploadResult> {
  if (!getToken()) throw new Error(t('uploads.error.notAuthenticated'));
  const { signal } = opts;
  const kind = opts.kind ?? inferMediaKind(file);
  const report = throttlePercent(opts.onProgress);
  const contentType = file.type || 'application/octet-stream';
  throwIfAborted(signal);
  const contentHash = await sha256OfFile(file, signal).catch(() => undefined);
  throwIfAborted(signal);
  const base = { versionId, filename: file.name, contentType, kind, size: file.size, contentHash };

  // Retenu dès la création côté serveur : un abandon survenu *pendant* l'envoi doit
  // encore savoir quel média libérer.
  let mediaObjectId: number | undefined;
  const remember = (id: number): void => {
    mediaObjectId = id;
  };
  try {
    const namingWarning =
      file.size < MULTIPART_THRESHOLD
        ? await uploadSmall(file, base, contentType, report, remember, signal)
        : await uploadLarge(file, base, report, remember, signal);
    report(100);
    throwIfAborted(signal);
    const { media } = await api.post<{ media: { status: string } }>(`/api/media/${mediaObjectId!}/finalize`);
    return { mediaObjectId: mediaObjectId!, status: media.status, namingWarning };
  } catch (err) {
    // Abandon : libérer les parts déjà déposées plutôt que de les laisser facturées.
    if (mediaObjectId !== undefined && (isAbortError(err) || signal?.aborted)) {
      void api.post(`/api/media/multipart/${mediaObjectId}/abort`).catch(() => undefined);
    }
    throw err;
  }
}

type InitBody = Record<string, unknown>;

/** Petit fichier : un seul PUT présigné, rien à reprendre. */
async function uploadSmall(
  file: File,
  base: InitBody,
  contentType: string,
  report: (pct: number) => void,
  remember: (id: number) => void,
  signal?: AbortSignal,
): Promise<boolean> {
  const created = await api.post<{
    mediaObjectId: number;
    uploadUrl: string;
    namingWarning?: boolean;
  }>('/api/media/upload-url', base);
  remember(created.mediaObjectId);
  await withRetry(
    () =>
      putWithProgress(
        created.uploadUrl,
        file,
        contentType,
        (loaded) => report(Math.min(99, Math.round((loaded / file.size) * 100))),
        signal,
      ),
    signal,
  );
  return created.namingWarning ?? false;
}

/** Gros fichier : multipart résumable, parts parallélisées. */
async function uploadLarge(
  file: File,
  base: InitBody,
  report: (pct: number) => void,
  remember: (id: number) => void,
  signal?: AbortSignal,
): Promise<boolean> {
  const init = await api.post<MultipartInit>('/api/media/multipart/init', base);
  remember(init.mediaObjectId);
  if (!init.deduplicated) {
    await uploadParts(file, init, report, signal);
    throwIfAborted(signal);
    await api.post(`/api/media/multipart/${init.mediaObjectId}/complete`, {
      parts: init.uploadedParts,
    });
  }
  return init.namingWarning ?? false;
}

/** Contexte partagé par les parts d'un même fichier (progression, annulation). */
interface PartContext {
  file: File;
  mediaObjectId: number;
  partSize: number;
  /** Octets déjà comptés pour chaque part en vol — la somme donne l'avancement réel. */
  inFlight: Map<number, number>;
  emit: () => void;
  signal?: AbortSignal;
}

async function partUrls(mediaObjectId: number, partNumbers: number[]): Promise<Map<number, string>> {
  const { urls } = await api.post<{ urls: { partNumber: number; url: string }[] }>(
    `/api/media/multipart/${mediaObjectId}/parts`,
    { partNumbers },
  );
  return new Map(urls.map((u) => [u.partNumber, u.url]));
}

/** Envoie une part, avec réessai : chaque nouvelle tentative repart d'une URL fraîche. */
async function sendPart(ctx: PartContext, partNumber: number, url: string): Promise<string> {
  const start = (partNumber - 1) * ctx.partSize;
  const blob = ctx.file.slice(start, Math.min(start + ctx.partSize, ctx.file.size));
  try {
    return await withRetry(async (tryIndex) => {
      // Une part qui a échoué a pu le faire sur une signature périmée (elles vivent une
      // heure) : la re-signer coûte un aller-retour et rend le réessai utile.
      const target =
        tryIndex === 0 ? url : ((await partUrls(ctx.mediaObjectId, [partNumber])).get(partNumber) ?? url);
      ctx.inFlight.set(partNumber, 0);
      // Pas de Content-Type sur les parts (la signature S3 ne le couvre pas).
      const etag = await putWithProgress(
        target,
        blob,
        null,
        (loaded) => {
          ctx.inFlight.set(partNumber, loaded);
          ctx.emit();
        },
        ctx.signal,
      );
      if (!etag) throw new Error(t('uploads.error.missingEtag'));
      return etag.replaceAll('"', '');
    }, ctx.signal);
  } finally {
    ctx.inFlight.delete(partNumber);
  }
}

/** Envoie les parts manquantes (les déjà reçues comptent dans la progression). */
async function uploadParts(
  file: File,
  init: MultipartInit,
  report: (pct: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const { partSize } = init;
  const totalParts = Math.ceil(file.size / partSize);
  const done = new Map(init.uploadedParts.map((p) => [p.partNumber, p.etag]));
  const sizeOf = (n: number) => Math.min(partSize, file.size - (n - 1) * partSize);
  let sent = [...done.keys()].reduce((acc, n) => acc + sizeOf(n), 0);
  const inFlight = new Map<number, number>();
  const emit = () => {
    let extra = 0;
    for (const loaded of inFlight.values()) extra += loaded;
    report(Math.min(99, Math.round(((sent + extra) / file.size) * 100)));
  };
  emit();

  const ctx: PartContext = { file, mediaObjectId: init.mediaObjectId, partSize, inFlight, emit, signal };
  const missing = Array.from({ length: totalParts }, (_, i) => i + 1).filter((n) => !done.has(n));
  for (let i = 0; i < missing.length; i += PART_URL_BATCH) {
    throwIfAborted(signal);
    const batch = missing.slice(i, i + PART_URL_BATCH);
    const urls = await partUrls(init.mediaObjectId, batch);
    await runPool(batch, PART_CONCURRENCY, async (partNumber) => {
      const etag = await sendPart(ctx, partNumber, urls.get(partNumber) ?? '');
      done.set(partNumber, etag);
      sent += sizeOf(partNumber);
      emit();
    });
  }
  // Trié : le parallélisme et les réessais terminent les parts dans le désordre, et un
  // `complete` lisible dans l'ordre du fichier vaut cher le jour où il faut le relire.
  init.uploadedParts = [...done.entries()]
    .map(([partNumber, etag]) => ({ partNumber, etag }))
    .sort((a, b) => a.partNumber - b.partNumber);
}
