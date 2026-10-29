// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * HTTP calls for the board.
 *
 * `lib/apiClient` only yields an `Error` carrying the message: the page could not
 * tell an editing conflict (409 `BOARD_CONFLICT`, which calls for a user choice) from an outage. The save
 * therefore goes through a direct `fetch` that keeps the status and error body — and falls back to `api.put` on a 401, to keep the
 * transparent token renewal that apiClient provides.
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
  /** `updatedAt` actually saved on the server — basis of a forced save. */
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
  /** Reference timestamp of this editing session. */
  updatedAt: string | null;
  /** Files already in MinIO: they will not be re-uploaded at the next save. */
  storedIds: Set<string>;
};

/** Loads the board and gives its images the shape Excalidraw expects. */
export async function loadBoard(base: string): Promise<LoadedBoard> {
  const data = await api.get<BoardResponse>(base);
  const document = data.board.document ?? {};
  const files = document.files ?? {};
  // To compute BEFORE rehydration: afterwards, every file has a dataURL.
  const storedIds = storedIdsOf(files);
  return {
    elements: document.elements ?? [],
    files: await rehydrateFiles(files, data.fileUrls ?? {}),
    updatedAt: data.board.updatedAt,
    storedIds,
  };
}

/** Direct upload URL into MinIO, in batches of 20 (server cap). */
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

/** Uploads an image to MinIO. Failure = save cancelled, nothing is lost locally. */
export async function uploadBoardFile(url: string, blob: Blob): Promise<void> {
  const res = await fetch(url, { method: 'PUT', body: blob, headers: { 'Content-Type': blob.type } });
  if (!res.ok) throw new Error(t('board.uploadFailed'));
}

type SaveBody = { document: BoardDocument; baseUpdatedAt: string | null };

/**
 * Save conditional on `baseUpdatedAt`: the server refuses (409) if someone has
 * saved since. Returns the new `updatedAt`, which becomes the basis of the
 * following saves.
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
  // Token expired: go back through the apiClient, the only one able to renew the session.
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
 * A full save: uploads to MinIO the images that became too heavy for the
 * document, then writes the lightened document. `stored` is enriched as it goes —
 * an uploaded image is never sent twice.
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
