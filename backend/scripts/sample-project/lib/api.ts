// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFile, stat } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { API_BASE } from '../config';

/**
 * Client HTTP du backend, réservé à ce que la base de données seule ne sait pas faire :
 * **déposer un fichier**.
 *
 * Toute la structure du projet de démonstration est écrite par Prisma (dates maîtrisées,
 * idempotence, volume), mais un média doit passer par le vrai chemin d'upload — URL
 * présignée, contrôle des magic bytes, mise en file du traitement — sinon rien n'est
 * transcodé : ni HLS, ni miniature, ni conversion USD/GLB, et la démonstration montre des
 * cartes vides.
 */

export interface Session {
  token: string;
  userId: number;
}

async function api<T>(session: Session | null, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(session ? { Authorization: `Bearer ${session.token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status} ${body.slice(0, 400)}`);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export async function login(email: string, password: string): Promise<Session> {
  const res = await api<{ token: string; user: { id: number } }>(null, '/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  return { token: res.token, userId: res.user.id };
}

/** Types MIME des extensions livrées par le générateur. */
const MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.exr': 'image/x-exr',
  '.glb': 'model/gltf-binary',
  '.usdz': 'model/vnd.usdz+zip',
  '.usda': 'model/vnd.usda',
  '.zip': 'application/zip',
  '.ply': 'application/octet-stream',
  '.spz': 'application/octet-stream',
};

export type MediaKindName = 'VIDEO' | 'IMAGE' | 'MODEL_3D' | 'SPLAT';

export interface UploadedMedia {
  id: number;
  status: string;
}

/**
 * Dépose un fichier sur une version : URL présignée, PUT, finalisation.
 *
 * Le PUT passe volontairement par `fetch` et non par l'API : c'est exactement ce que fait
 * le navigateur, et c'est le seul chemin qui exerce la vérification d'en-tête côté serveur.
 */
export async function uploadMedia(
  session: Session,
  versionId: number,
  filePath: string,
  kind: MediaKindName,
): Promise<UploadedMedia> {
  const filename = basename(filePath);
  const contentType = MIME[extname(filename).toLowerCase()] ?? 'application/octet-stream';
  const size = (await stat(filePath)).size;

  const created = await api<{ mediaObjectId: number; uploadUrl: string }>(session, '/media/upload-url', {
    method: 'POST',
    body: JSON.stringify({ versionId, filename, contentType, kind, size }),
  });

  const body = await readFile(filePath);
  const put = await fetch(created.uploadUrl, { method: 'PUT', body });
  if (!put.ok) throw new Error(`PUT ${filename} → ${put.status}`);

  const finalized = await api<{ media: { id: number; status: string } }>(
    session,
    `/media/${created.mediaObjectId}/finalize`,
    { method: 'POST' },
  );
  return { id: finalized.media.id, status: finalized.media.status };
}

/**
 * Dépose une séquence d'images : N fichiers, **un** média.
 *
 * C'est le livrable réel du compositing (`SH0100_comp_v003.1001.exr` → `…1188.exr`), et le
 * protocole n'a rien à voir avec celui d'un fichier unique : ouverture de la séquence, URLs
 * présignées par lots, puis finalisation qui écrit le manifeste et enfile l'assemblage.
 */
export async function uploadSequence(
  session: Session,
  versionId: number,
  pattern: string,
  framePaths: string[],
  framerate: number,
): Promise<UploadedMedia> {
  const frames = await Promise.all(
    framePaths.map(async (path) => ({ name: basename(path), size: (await stat(path)).size })),
  );
  const opened = await api<{ mediaObjectId: number }>(session, '/media/sequence/init', {
    method: 'POST',
    body: JSON.stringify({ versionId, pattern, frames, framerate }),
  });

  const BATCH = 32;
  for (let offset = 0; offset < framePaths.length; offset += BATCH) {
    const slice = framePaths.slice(offset, offset + BATCH);
    const urls = await api<{ urls: { name: string; url: string }[] }>(
      session,
      `/media/sequence/${opened.mediaObjectId}/urls`,
      { method: 'POST', body: JSON.stringify({ names: slice.map((p) => basename(p)) }) },
    );
    const byName = new Map(urls.urls.map((u) => [u.name, u.url]));
    await Promise.all(
      slice.map(async (path) => {
        const url = byName.get(basename(path));
        if (!url) throw new Error(`no upload URL for ${basename(path)}`);
        const put = await fetch(url, { method: 'PUT', body: await readFile(path) });
        if (!put.ok) throw new Error(`PUT ${basename(path)} → ${put.status}`);
      }),
    );
  }

  const done = await api<{ media?: { id: number; status: string } }>(
    session,
    `/media/sequence/${opened.mediaObjectId}/complete`,
    { method: 'POST' },
  );
  return { id: done.media?.id ?? opened.mediaObjectId, status: done.media?.status ?? 'PROCESSING' };
}

/** Publie un média (verrou de publication : le contenu devient définitif). */
export async function publishMedia(session: Session, mediaId: number): Promise<void> {
  await api(session, `/media/${mediaId}/publish`, { method: 'POST' });
}

/** État courant d'un média (attente de fin de traitement). */
export async function mediaStatus(session: Session, mediaId: number): Promise<string> {
  const res = await api<{ media?: { status: string }; status?: string }>(session, `/media/${mediaId}`);
  return res.media?.status ?? res.status ?? 'UNKNOWN';
}

/**
 * Attend la fin du traitement d'un lot de médias. Un média en échec n'interrompt pas la
 * génération : il est renvoyé pour être signalé en fin de course.
 */
export async function waitForProcessing(
  session: Session,
  ids: number[],
  opts: { timeoutMs?: number; onProgress?: (done: number, total: number) => void } = {},
): Promise<{ ready: number[]; failed: number[] }> {
  const deadline = Date.now() + (opts.timeoutMs ?? 20 * 60 * 1000);
  const pending = new Set(ids);
  const ready: number[] = [];
  const failed: number[] = [];

  while (pending.size > 0 && Date.now() < deadline) {
    for (const id of [...pending]) {
      const status = await mediaStatus(session, id).catch(() => 'UNKNOWN');
      if (status === 'READY') {
        pending.delete(id);
        ready.push(id);
      } else if (status === 'FAILED') {
        pending.delete(id);
        failed.push(id);
      }
    }
    opts.onProgress?.(ids.length - pending.size, ids.length);
    if (pending.size > 0) await new Promise((r) => setTimeout(r, 2000));
  }
  return { ready, failed: [...failed, ...pending] };
}
