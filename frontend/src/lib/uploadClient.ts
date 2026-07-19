import { createSHA256 } from 'hash-wasm';
import { api, getToken } from './apiClient';
import type { MediaKind } from '../v2/types/api';

const MODEL_EXT = ['.glb', '.gltf', '.fbx', '.usdz', '.usdc', '.usda', '.obj', '.zip'];
// Gaussian Splat (viewer Spark/SparkJS) — cf. detectSplat côté backend.
const SPLAT_EXT = ['.ply', '.splat', '.spz', '.ksplat', '.sog', '.sogs'];

/** Au-delà de ce seuil : multipart résumable (37.A). La taille de part vient du serveur. */
const MULTIPART_THRESHOLD = 16 * 1024 * 1024;
const HASH_CHUNK = 8 * 1024 * 1024;
/** URLs de parts demandées par lots (bornées côté serveur à 64). */
const PART_URL_BATCH = 16;

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

/** sha256 hex du fichier, en flux (hash-wasm) — checksum bout-en-bout + dédup (37.B). */
export async function sha256OfFile(file: File): Promise<string> {
  const hasher = await createSHA256();
  for (let off = 0; off < file.size; off += HASH_CHUNK) {
    const buf = await file.slice(off, off + HASH_CHUNK).arrayBuffer();
    hasher.update(new Uint8Array(buf));
  }
  return hasher.digest('hex');
}

/** PUT XHR avec progression ; renvoie l'ETag (multipart) — null si absent. */
function putWithProgress(
  url: string,
  body: Blob,
  contentType: string | null,
  onProgress: (loaded: number) => void,
): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    if (contentType) xhr.setRequestHeader('Content-Type', contentType);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded);
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve(xhr.getResponseHeader('ETag'))
        : reject(new Error(`PUT ${xhr.status}`));
    xhr.onerror = () => reject(new Error("Erreur réseau pendant l'upload"));
    xhr.send(body);
  });
}

export interface UploadResult {
  mediaObjectId: number;
  status: string;
  /** Contenu identique déjà présent : aucun octet transféré (37.B). */
  deduplicated?: boolean;
}

interface MultipartInit {
  mediaObjectId: number;
  partSize: number;
  uploadedParts: { partNumber: number; etag: string }[];
  deduplicated?: boolean;
  resumed?: boolean;
}

/**
 * Flux d'upload v2 (37.A/37.B) :
 *  1) sha256 du fichier (checksum bout-en-bout + dédup) ;
 *  2) petits fichiers → PUT présigné direct ; gros → multipart résumable
 *     (la reprise saute les parts déjà reçues, connues du serveur via ListParts) ;
 *  3) finalize : validation magic bytes + traitement.
 */
export async function uploadMedia(
  file: File,
  versionId: number,
  opts: { kind?: MediaKind; onProgress?: (pct: number) => void } = {},
): Promise<UploadResult> {
  if (!getToken()) throw new Error('Non authentifié');
  const kind = opts.kind ?? inferMediaKind(file);
  const onProgress = opts.onProgress ?? (() => {});
  const contentType = file.type || 'application/octet-stream';
  const contentHash = await sha256OfFile(file).catch(() => undefined);
  const base = { versionId, filename: file.name, contentType, kind, size: file.size, contentHash };

  let mediaObjectId: number;
  if (file.size < MULTIPART_THRESHOLD) {
    const created = await api.post<{ mediaObjectId: number; uploadUrl: string }>(
      '/api/media/upload-url',
      base,
    );
    mediaObjectId = created.mediaObjectId;
    await putWithProgress(created.uploadUrl, file, contentType, (loaded) =>
      onProgress(Math.round((loaded / file.size) * 100)),
    );
  } else {
    const init = await api.post<MultipartInit>('/api/media/multipart/init', base);
    mediaObjectId = init.mediaObjectId;
    if (!init.deduplicated) {
      await uploadParts(file, init, onProgress);
      await api.post(`/api/media/multipart/${mediaObjectId}/complete`, {
        parts: init.uploadedParts,
      });
    }
  }

  onProgress(100);
  const { media } = await api.post<{ media: { status: string } }>(`/api/media/${mediaObjectId}/finalize`);
  return { mediaObjectId, status: media.status };
}

/** Envoie les parts manquantes (les déjà reçues comptent dans la progression). */
async function uploadParts(
  file: File,
  init: MultipartInit,
  onProgress: (pct: number) => void,
): Promise<void> {
  const { partSize } = init;
  const totalParts = Math.ceil(file.size / partSize);
  const done = new Map(init.uploadedParts.map((p) => [p.partNumber, p.etag]));
  let sent = [...done.keys()].reduce((acc, n) => acc + Math.min(partSize, file.size - (n - 1) * partSize), 0);
  const report = (extra: number) => onProgress(Math.min(99, Math.round(((sent + extra) / file.size) * 100)));
  report(0);

  const missing = Array.from({ length: totalParts }, (_, i) => i + 1).filter((n) => !done.has(n));
  for (let i = 0; i < missing.length; i += PART_URL_BATCH) {
    const batch = missing.slice(i, i + PART_URL_BATCH);
    const { urls } = await api.post<{ urls: { partNumber: number; url: string }[] }>(
      `/api/media/multipart/${init.mediaObjectId}/parts`,
      { partNumbers: batch },
    );
    for (const { partNumber, url } of urls) {
      const start = (partNumber - 1) * partSize;
      const blob = file.slice(start, Math.min(start + partSize, file.size));
      // Pas de Content-Type sur les parts (la signature S3 ne le couvre pas).
      const etag = await putWithProgress(url, blob, null, (loaded) => report(loaded));
      if (!etag) throw new Error('ETag absent de la réponse MinIO (CORS ExposeHeaders ?)');
      done.set(partNumber, etag.replaceAll('"', ''));
      sent += blob.size;
      report(0);
    }
  }
  init.uploadedParts = [...done.entries()].map(([partNumber, etag]) => ({ partNumber, etag }));
}
