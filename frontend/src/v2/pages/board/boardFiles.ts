// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Board images: moving from base64 dataURL to object storage.
 *
 * Excalidraw keeps each pasted image in `files` as a base64 dataURL. The whole
 * document was therefore sent on every autosave: two screenshots were enough to exceed
 * the server's body limit, and the user lost their work on a 413.
 *
 * Large files are now uploaded to MinIO; the document keeps only
 * `{ id, mimeType }`. On load, the editor fetches them back and rebuilds the dataURL,
 * so Excalidraw receives exactly what it received before; only the transport changed.
 * Small files stay inline: fewer round trips, and this covers the
 * formats that MinIO only returns as `octet-stream`.
 *
 * These bounds must stay aligned with `backend/src/services/BoardService.ts`.
 */

/** dataURL length below which a file stays in the document (about 46 KB). */
export const MAX_INLINE_DATAURL = 64_000;

/** Types the server accepts to store (see `UPLOADABLE_TYPES` on the backend). */
const UPLOADABLE = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/bmp',
  'image/svg+xml',
  'application/octet-stream',
]);

export type BoardFile = {
  id: string;
  mimeType: string;
  dataURL?: string;
  created?: number;
  lastRetrieved?: number;
};

export type BoardFiles = Record<string, BoardFile>;
export type BoardDocument = { elements: unknown[]; files: BoardFiles };

/** Fallback type for a file whose format Excalidraw could not name. */
const fallbackType = (mimeType: string | undefined): string =>
  mimeType && UPLOADABLE.has(mimeType) ? mimeType : 'application/octet-stream';

/** Image to upload to MinIO: its dataURL is guaranteed present. */
export type BoardUpload = { id: string; mimeType: string; dataURL: string };

/**
 * Files to upload to MinIO before the next save: those that still carry a
 * dataURL too long to stay in the document and are not already there.
 */
export function filesToUpload(files: BoardFiles, stored: ReadonlySet<string>): BoardUpload[] {
  const out: BoardUpload[] = [];
  for (const [id, file] of Object.entries(files)) {
    if (!file || stored.has(id)) continue;
    const { dataURL } = file;
    if (typeof dataURL !== 'string' || dataURL.length <= MAX_INLINE_DATAURL) continue;
    out.push({ id, mimeType: fallbackType(file.mimeType), dataURL });
  }
  return out;
}

/**
 * Document as it is sent to the server: the dataURL of already stored files is removed,
 * small files stay inline. `lastRetrieved` is Excalidraw session metadata,
 * it has no business in the database.
 */
export function toSavedDocument(
  elements: readonly unknown[],
  files: BoardFiles,
  stored: ReadonlySet<string>,
): BoardDocument {
  const out: BoardFiles = {};
  for (const [id, file] of Object.entries(files)) {
    if (!file) continue;
    const base: BoardFile = { id, mimeType: fallbackType(file.mimeType) };
    if (file.created !== undefined) base.created = file.created;
    if (!stored.has(id)) base.dataURL = file.dataURL;
    out[id] = base;
  }
  return { elements: [...elements], files: out };
}

/** IDs already stored in MinIO according to a re-read document: those without a dataURL. */
export function storedIdsOf(files: BoardFiles): Set<string> {
  return new Set(
    Object.entries(files)
      .filter(([, f]) => f && f.dataURL === undefined)
      .map(([id]) => id),
  );
}

/** dataURL → binary, for direct upload to MinIO. */
export function dataURLToBlob(dataURL: string): Blob {
  const comma = dataURL.indexOf(',');
  const head = dataURL.slice(0, comma < 0 ? dataURL.length : comma);
  const body = comma < 0 ? '' : dataURL.slice(comma + 1);
  const type = /^data:([^;,]+)/.exec(head)?.[1] ?? 'application/octet-stream';
  if (!head.includes(';base64')) return new Blob([decodeURIComponent(body)], { type });
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}

/** Binary → dataURL, to give Excalidraw the shape it expects. */
export function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Fetches the stored files back and rebuilds their dataURL. The type is taken from the
 * document and not from the response: MinIO serves non-raster formats as `octet-stream`.
 * A file not found is removed from the batch: Excalidraw then shows its own fallback,
 * rather than receiving an entry without an image.
 */
export async function rehydrateFiles(
  files: BoardFiles,
  fileUrls: Record<string, string>,
  fetcher: typeof fetch = fetch,
): Promise<BoardFiles> {
  const out: BoardFiles = { ...files };
  await Promise.all(
    Object.entries(fileUrls).map(async ([id, url]) => {
      const file = files[id];
      if (!file) return;
      try {
        const res = await fetcher(url);
        if (!res.ok) throw new Error(String(res.status));
        const buffer = await res.arrayBuffer();
        out[id] = { ...file, dataURL: await blobToDataURL(new Blob([buffer], { type: file.mimeType })) };
      } catch {
        delete out[id];
      }
    }),
  );
  return out;
}
