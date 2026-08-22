// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Appels HTTP du board.
 *
 * `lib/apiClient` ne rend qu'un `Error` porteur du message : la page ne pourrait pas
 * distinguer un conflit d'édition (409 `BOARD_CONFLICT`, qui appelle un choix de
 * l'utilisateur) d'une panne. La sauvegarde passe donc par un `fetch` direct qui conserve
 * le statut et le corps d'erreur — et retombe sur `api.put` en cas de 401, pour garder le
 * renouvellement de jeton transparent qu'assure l'apiClient.
 */

import { api, getToken } from '../../../lib/apiClient';
import { t } from '../../i18n';
import {
  dataURLToBlob,
  filesToUpload,
  rehydrateFiles,
  storedIdsOf,
  toSavedDocument,
  type BoardDocument,
  type BoardFiles,
} from './boardFiles';

export type BoardScope = 'project' | 'asset';

export class BoardConflictError extends Error {
  /** `updatedAt` réellement enregistré côté serveur — base d'une sauvegarde forcée. */
  serverUpdatedAt: string | null;
  constructor(message: string, serverUpdatedAt: string | null) {
    super(message);
    this.name = 'BoardConflictError';
    this.serverUpdatedAt = serverUpdatedAt;
  }
}

export const boardBase = (scope: BoardScope, id: number): string => `/api/boards/${scope}/${id}`;

type BoardResponse = {
  board: { document?: { elements?: unknown[]; files?: BoardFiles } | null; updatedAt: string | null };
  fileUrls?: Record<string, string>;
};

export type LoadedBoard = {
  elements: unknown[];
  files: BoardFiles;
  /** Horodatage de référence de cette session d'édition. */
  updatedAt: string | null;
  /** Fichiers déjà dans MinIO : ils ne seront pas redéposés à la prochaine sauvegarde. */
  storedIds: Set<string>;
};

/** Charge le board et redonne à ses images la forme attendue par Excalidraw. */
export async function loadBoard(base: string): Promise<LoadedBoard> {
  const data = await api.get<BoardResponse>(base);
  const document = data.board.document ?? {};
  const files = document.files ?? {};
  // À calculer AVANT la réhydratation : après, tous les fichiers ont une dataURL.
  const storedIds = storedIdsOf(files);
  return {
    elements: document.elements ?? [],
    files: await rehydrateFiles(files, data.fileUrls ?? {}),
    updatedAt: data.board.updatedAt,
    storedIds,
  };
}

/** URL de dépôt direct dans MinIO, par lots de 20 (plafond du serveur). */
export async function presignBoardFiles(
  base: string,
  files: { id: string; mimeType: string }[],
): Promise<{ id: string; url: string }[]> {
  const out: { id: string; url: string }[] = [];
  for (let i = 0; i < files.length; i += 20) {
    const chunk = files.slice(i, i + 20);
    const res = await api.post<{ uploads: { id: string; url: string }[] }>(`${base}/files`, {
      files: chunk,
    });
    out.push(...res.uploads);
  }
  return out;
}

/** Dépôt d'une image dans MinIO. Échec = sauvegarde annulée, rien n'est perdu localement. */
export async function uploadBoardFile(url: string, blob: Blob): Promise<void> {
  const res = await fetch(url, { method: 'PUT', body: blob, headers: { 'Content-Type': blob.type } });
  if (!res.ok) throw new Error(t('board.uploadFailed'));
}

type SaveBody = { document: BoardDocument; baseUpdatedAt: string | null };

/**
 * Sauvegarde conditionnée à `baseUpdatedAt` : le serveur refuse (409) si quelqu'un a
 * enregistré depuis. Rend le nouvel `updatedAt`, qui devient la base des sauvegardes
 * suivantes.
 */
export async function saveBoard(base: string, body: SaveBody): Promise<string> {
  const res = await fetch(base, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...(getToken() ? { Authorization: `Bearer ${getToken()!}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (res.ok) {
    const data = (await res.json()) as { board: { updatedAt: string } };
    return data.board.updatedAt;
  }
  // Jeton expiré : on repasse par l'apiClient, seul à savoir renouveler la session.
  if (res.status === 401) {
    const data = await api.put<{ board: { updatedAt: string } }>(base, body);
    return data.board.updatedAt;
  }
  const payload = (await res.json().catch(() => ({}))) as {
    error?: string;
    code?: string;
    updatedAt?: string | null;
  };
  if (res.status === 409 && payload.code === 'BOARD_CONFLICT') {
    throw new BoardConflictError(t('board.conflictMessage'), payload.updatedAt ?? null);
  }
  throw new Error(payload.error ?? t('common.error.http', { status: res.status }));
}

/**
 * Une sauvegarde complète : dépôt dans MinIO des images devenues trop lourdes pour le
 * document, puis écriture du document allégé. `stored` est enrichi au fur et à mesure —
 * une image déposée ne repart jamais deux fois.
 */
export async function persistBoard(
  base: string,
  snapshot: { elements: readonly unknown[]; files: BoardFiles },
  stored: Set<string>,
  baseUpdatedAt: string | null,
): Promise<string> {
  const pending = filesToUpload(snapshot.files, stored);
  if (pending.length > 0) {
    const uploads = await presignBoardFiles(
      base,
      pending.map(({ id, mimeType }) => ({ id, mimeType })),
    );
    const urls = new Map(uploads.map((u) => [u.id, u.url] as const));
    await Promise.all(
      pending.map(async (file) => {
        const url = urls.get(file.id);
        if (!url) return;
        await uploadBoardFile(url, dataURLToBlob(file.dataURL));
        stored.add(file.id);
      }),
    );
  }
  const document = toSavedDocument(snapshot.elements, snapshot.files, stored);
  return saveBoard(base, { document, baseUpdatedAt });
}
