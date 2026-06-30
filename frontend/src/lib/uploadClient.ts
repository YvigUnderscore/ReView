import { api, getToken } from './apiClient';

/** Types de média côté backend (enum MediaKind). */
export type MediaKind = 'VIDEO' | 'IMAGE' | 'MODEL_3D' | 'SPLAT';

const SPLAT_EXT = ['.ply', '.splat', '.sog'];
const MODEL_EXT = ['.glb', '.gltf', '.fbx', '.usdz', '.usdc', '.usda', '.obj', '.zip'];

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

/** Upload présigné direct navigateur → MinIO via XHR, avec progression. */
function putWithProgress(url: string, file: File, onProgress: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`PUT ${xhr.status}`)));
    xhr.onerror = () => reject(new Error('Erreur réseau pendant l\'upload'));
    xhr.send(file);
  });
}

export interface UploadResult {
  mediaObjectId: number;
  status: string;
}

/**
 * Flux d'upload v2 complet et non-bloquant :
 *  1) demande une URL présignée PUT au backend (crée le MediaObject)
 *  2) PUT direct navigateur → MinIO (progression)
 *  3) finalize : le backend valide les magic bytes et déclenche le traitement
 */
export async function uploadMedia(
  file: File,
  versionId: number,
  opts: { kind?: MediaKind; onProgress?: (pct: number) => void } = {},
): Promise<UploadResult> {
  if (!getToken()) throw new Error('Non authentifié');
  const kind = opts.kind ?? inferMediaKind(file);

  const { mediaObjectId, uploadUrl } = await api.post<{ mediaObjectId: number; uploadUrl: string }>(
    '/api/media/upload-url',
    { versionId, filename: file.name, contentType: file.type || 'application/octet-stream', kind, size: file.size },
  );

  await putWithProgress(uploadUrl, file, opts.onProgress ?? (() => {}));

  const { media } = await api.post<{ media: { status: string } }>(`/api/media/${mediaObjectId}/finalize`);
  return { mediaObjectId, status: media.status };
}
