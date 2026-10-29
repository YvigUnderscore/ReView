// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError, badRequest } from '../lib/errors';
import { storage } from '../lib/storage';

/**
 * Mood/reference boards (9.B): persistence of the Excalidraw scene.
 *
 * Two scaling defects fixed here:
 *
 *  1. **Images no longer live in the JSON.** Excalidraw stores pasted images in `files` as base64 dataURLs.
 *     Two screenshots were enough to push the document above `express.json({ limit: '2mb' })`: every autosave
 *     went back as a 413 and the work was lost. Large files are now uploaded to MinIO like any media; the
 * document only keeps `{ id, mimeType }`, and the storage key is **rebuilt here** (never received from the
 * client), otherwise a board could point to any object in the bucket. Small files (SVG, icons) stay inline
 *     under a strict ceiling: that is the only way to keep displaying formats MinIO cannot serve for direct
 *     rendering.
 * 2. **No more silent overwrites.** The write carries the `updatedAt` the editor loaded the board with, and
 * the update is conditional: if someone saved in the meantime, the response is a 409 `BOARD_CONFLICT`
 * carrying
 *     the current `updatedAt`.
 *
 * Compatibility: a board already saved with base64 images reads back as is (reading validates nothing) and is
 * migrated on the editor's next save.
 */

export type BoardScope = { projectId: number } | { assetId: number };

/** Number of Excalidraw elements accepted in a document. */
export const MAX_ELEMENTS = 10_000;
/** Number of `files` entries accepted in a document. */
export const MAX_FILES = 500;
/** Maximum length of a dataURL left inline (about 46 KB of image). */
export const MAX_INLINE_DATAURL = 64_000;
/** Maximum serialized size of the document, under Express's body limit. */
export const MAX_DOCUMENT_BYTES = 1_500_000;

/**
 * Excalidraw file identifier. It becomes a MinIO key segment: the allow-list of characters is what forbids
 * `../` and forged keys. It stays tolerant (a dot accepted in an inner position) because a board imported
 * from an `.excalidraw` brings identifiers we did not produce, but never a separator, hence never a
 * traversal.
 */
const FILE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
export const fileIdSchema = z.string().regex(FILE_ID_RE, 'Invalid board file id');

/**
 * Types that can be uploaded to MinIO.
 *
 * This list gives no safety guarantee: what protects is `lib/uploadContentType`, which brings every active
 * type (SVG, HTML) back to `application/octet-stream` both on upload and on read. This list serves to refuse
 * documents that are obviously malformed. SVG is accepted because the editor rebuilds the dataURL from the
 * declared type and displays it in an `<img>`, where an SVG executes nothing.
 */
const UPLOADABLE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/bmp',
  'image/svg+xml',
  'application/octet-stream',
]);

export const isUploadableType = (mimeType: string): boolean => UPLOADABLE_TYPES.has(mimeType);

const boardFileSchema = z
  .object({
    id: fileIdSchema,
    mimeType: z.string().min(1).max(80),
    // Absent = the file is in MinIO under the key derived from its id.
    dataURL: z.string().max(MAX_INLINE_DATAURL).optional(),
    created: z.number().int().nonnegative().optional(),
    lastRetrieved: z.number().int().nonnegative().optional(),
  })
  .strict();

/** Excalidraw element: minimal enforced shape; the remaining attributes pass through unchanged. */
const boardElementSchema = z
  .object({ id: z.string().min(1).max(128), type: z.string().min(1).max(40) })
  .passthrough();

/** Bounded document schema: replaces the original `z.any()`. */
export const boardDocumentSchema = z
  .object({
    elements: z.array(boardElementSchema).max(MAX_ELEMENTS).default([]),
    files: z.record(fileIdSchema, boardFileSchema).prefault({}),
  })
  .strict()
  .superRefine((doc, ctx) => {
    const ids = Object.keys(doc.files);
    if (ids.length > MAX_FILES) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['files'],
        message: `Too many board files (${ids.length} > ${MAX_FILES})`,
      });
    }
    for (const id of ids) {
      const file = doc.files[id]!;
      // The id carried by the entry is used to build the storage key: it must be the one under which the
      // entry is stored, otherwise the file read is not the one written.
      if (file.id !== id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['files', id, 'id'],
          message: 'Board file id does not match its key',
        });
      }
      if (file.dataURL === undefined && !isUploadableType(file.mimeType)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['files', id, 'mimeType'],
          message: `Unsupported stored board image type: ${file.mimeType}`,
        });
      }
    }
    const bytes = Buffer.byteLength(JSON.stringify(doc));
    if (bytes > MAX_DOCUMENT_BYTES) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['elements'],
        message: `Board document too large (${bytes} > ${MAX_DOCUMENT_BYTES} bytes) — paste fewer or smaller images`,
      });
    }
  });

export type BoardDocument = z.infer<typeof boardDocumentSchema>;

// ── Storage keys ─────────────────────────────────────────────────────────────
/**
 * MinIO prefix of a board.
 *
 * It is **filed under its project**: `lib/trash.purgeProject` already sweeps `projects/{id}/`, so a board's
 * images leave with the purged project without a second place to maintain. One board per project and one per
 * asset: the id appears only for the latter.
 */
export const boardPrefix = (projectId: number, scope: BoardScope): string =>
  'projectId' in scope
    ? `projects/${projectId}/boards/project/`
    : `projects/${projectId}/boards/asset/${scope.assetId}/`;

/** Key of a board file: derived from the scope and the id, never received from the client. */
export const boardFileKey = (projectId: number, scope: BoardScope, fileId: string): string => {
  if (!FILE_ID_RE.test(fileId)) throw badRequest('Invalid board file id', 'BAD_FILE_ID');
  return `${boardPrefix(projectId, scope)}${fileId}`;
};

// ── Read ─────────────────────────────────────────────────────────────────────

type StoredFile = { mimeType?: string; dataURL?: string };
type StoredDocument = { files?: Record<string, StoredFile | null> };

/** Board as sent to the client: the original shape, plus `fileUrls`. */
export type BoardPayload = {
  id?: number;
  projectId?: number | null;
  assetId?: number | null;
  document: unknown;
  updatedAt: Date | null;
};

export type BoardRead = {
  board: BoardPayload;
  /** Presigned read URL per externalised file: empty for a legacy board. */
  fileUrls: Record<string, string>;
};

/**
 * Reads the board and signs access to its externalised files. The response's `Content-Type` is enforced in
 * the signature: the type sent by the browser is not reliable.
 */
export async function readBoard(projectId: number, scope: BoardScope): Promise<BoardRead> {
  const board = await prisma.board.findUnique({ where: scope });
  const document = (board?.document ?? {}) as StoredDocument;
  const external = Object.entries(document.files ?? {}).filter(
    ([id, file]) => file && typeof file === 'object' && !file.dataURL && FILE_ID_RE.test(id),
  );
  const signed = await Promise.all(
    external.map(async ([id, file]) => {
      const key = boardFileKey(projectId, scope, id);
      return [id, await storage.getPresignedGetUrl(key, 3600, file!.mimeType)] as const;
    }),
  );
  return {
    board: board ?? { ...scope, document: {}, updatedAt: null },
    fileUrls: Object.fromEntries(signed),
  };
}

// ── Write ────────────────────────────────────────────────────────────────────

const boardConflict = (updatedAt: Date | null | undefined): AppError =>
  new AppError('Board changed since it was loaded', 409, 'BOARD_CONFLICT', {
    updatedAt: updatedAt ? updatedAt.toISOString() : null,
  });

/**
 * Writes the document if nobody has saved since `baseUpdatedAt` (ISO, or `null` for "the board did not
 * exist"). The expected `updatedAt` is carried by the update's `where`: the condition is evaluated by
 * Postgres, so two simultaneous saves cannot both satisfy it.
 */
export async function writeBoard(
  scope: BoardScope,
  document: BoardDocument,
  baseUpdatedAt: string | null,
): Promise<{ id: number; document: unknown; updatedAt: Date }> {
  const data = { document: document as unknown as Prisma.InputJsonValue };

  if (baseUpdatedAt === null) {
    try {
      return await prisma.board.create({ data: { ...scope, ...data } });
    } catch (err) {
      // P2002 = uniqueness on projectId/assetId: the board already exists, someone created it while editing.
      // Any other error remains an error.
      if ((err as { code?: string }).code !== 'P2002') throw err;
      const current = await prisma.board.findUnique({ where: scope, select: { updatedAt: true } });
      throw boardConflict(current?.updatedAt);
    }
  }

  const expected = new Date(baseUpdatedAt);
  const res = await prisma.board.updateMany({ where: { ...scope, updatedAt: expected }, data });
  if (res.count === 0) {
    const current = await prisma.board.findUnique({ where: scope, select: { updatedAt: true } });
    throw boardConflict(current?.updatedAt);
  }
  return (await prisma.board.findUnique({ where: scope }))!;
}

// ── Image uploads ────────────────────────────────────────────────────────────

/**
 * Upload presigned URLs for files too large to stay in the document. The browser writes directly to MinIO, as
 * for a media.
 */
export async function presignBoardFiles(
  projectId: number,
  scope: BoardScope,
  files: { id: string; mimeType: string }[],
): Promise<{ id: string; url: string }[]> {
  return Promise.all(
    files.map(async ({ id, mimeType }) => {
      if (!isUploadableType(mimeType)) {
        throw badRequest(`Unsupported board image type: ${mimeType}`, 'BAD_CONTENT_TYPE');
      }
      const key = boardFileKey(projectId, scope, id);
      // The content is about to change under this key: the remembered read URL must be forgotten, otherwise
      // the browser would serve the old image from its cache.
      storage.forgetPresignedUrl(key);
      return { id, url: await storage.getPresignedPutUrl(key, mimeType, 900) };
    }),
  );
}
