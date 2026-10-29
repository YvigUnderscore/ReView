// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Role } from '@prisma/client';
import { badRequest } from '../lib/errors';
import { checkProjectAccess } from '../middleware/rbac';
import { storage } from './StorageService';
import { NOTE_KINDS, resolveProject, type NoteKind } from './EntityNoteService';

/**
 * The images that a sheet carries itself.
 *
 * A sheet could only show images already online elsewhere: one pasted a URL, and the sheet died with the
 * remote server. Images now live in the bucket, uploaded like an entity
 * thumbnail — presigned, then a direct PUT from the browser, never passing through the API.
 *
 * What is **written in the sheet is the key**, not a URL: a presigned URL expires after an hour, and a brief
 * gets re-read six months later. The text therefore stays stable, and
 * `resolveMany` regenerates read URLs at each display.
 *
 * The key carries the entity (`note-images/{kind}/{id}/…`) and it is that which decides access: reading a
 * shot's image amounts to reading that shot, hence being a member of its project.
 * Without this check, a guessed key would have sufficed to pull the sheet out of a closed project.
 */

export const NOTE_IMAGE_PREFIX = 'note-images/';

/** Number of keys resolved at once — a whole sheet fits comfortably. */
export const MAX_RESOLVE_KEYS = 80;

const EXTENSIONS: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/avif': '.avif',
};

/** The uploaded name serves as a human marker in the bucket — it decides nothing. */
function safeName(filename: string): string {
  const base = filename.replace(/\.[^.]*$/, '').replace(/[^a-zA-Z0-9._-]/g, '_');
  return base.slice(0, 60) || 'image';
}

/**
 * The entity designated by a key, or `null` if the key is not a sheet image.
 *
 * Pure function, and deliberately strict: a non-numeric identifier, one segment too many, a `..` — anything
 * that does not look exactly like the convention is refused rather than
 * interpreted. This is what makes the downstream access check reliable.
 */
export function parseNoteImageKey(key: string): { kind: NoteKind; id: number } | null {
  if (key.includes('..')) return null;
  const match = /^note-images\/([a-z]+)\/(\d+)\/[A-Za-z0-9._-]+$/.exec(key);
  if (!match) return null;
  const kind = match[1] as NoteKind;
  if (!NOTE_KINDS.includes(kind)) return null;
  const id = Number(match[2]);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  return { kind, id };
}

/** The key of an image to upload — computed here, never received from the client. */
export function buildNoteImageKey(kind: NoteKind, id: number, filename: string, contentType: string) {
  const ext = EXTENSIONS[contentType];
  if (!ext) throw badRequest('Unsupported image type', 'BAD_CONTENT_TYPE');
  return `${NOTE_IMAGE_PREFIX}${kind}/${id}/${Date.now()}-${safeName(filename)}${ext}`;
}

/**
 * Upload URL, and the read URL that goes with it.
 *
 * The second avoids a round trip: the image must display in the editor the second it is uploaded, otherwise
 * one believes the upload failed and starts again.
 */
export async function presign(kind: NoteKind, id: number, filename: string, contentType: string) {
  const key = buildNoteImageKey(kind, id, filename, contentType);
  const [url, readUrl] = await Promise.all([
    storage.getPresignedPutUrl(key, contentType, 900),
    storage.getPresignedGetUrl(key),
  ]);
  return { url, key, readUrl };
}

/**
 * The read URLs of a batch of keys.
 *
 * Keys are grouped by entity so that access is checked only once per shot: a board of twenty images must not
 * cost twenty membership queries. A key foreign to the convention is ignored
 * without error — an old sheet may still point outside, and that is not a fault.
 */
export async function resolveMany(
  viewer: { id: number; role: Role },
  keys: string[],
): Promise<Record<string, string>> {
  const unique = [...new Set(keys)].slice(0, MAX_RESOLVE_KEYS);
  const byEntity = new Map<string, { kind: NoteKind; id: number; keys: string[] }>();

  for (const key of unique) {
    const target = parseNoteImageKey(key);
    if (!target) continue;
    const bucket = `${target.kind}:${target.id}`;
    const entry = byEntity.get(bucket) ?? { ...target, keys: [] };
    entry.keys.push(key);
    byEntity.set(bucket, entry);
  }

  const out: Record<string, string> = {};
  await Promise.all(
    [...byEntity.values()].map(async ({ kind, id, keys: entityKeys }) => {
      // A vanished entity does not fail the batch: a sheet may cite the image of a shot deleted since, and
      // refusing the whole batch would make the twenty valid images of the board disappear
      // for a dead reference.
      const projectId = await resolveProject(kind, id).catch(() => null);
      if (projectId === null) return;
      if (!(await checkProjectAccess(viewer.id, viewer.role, projectId))) return;
      await Promise.all(
        entityKeys.map(async (key) => {
          out[key] = await storage.getPresignedGetUrl(key);
        }),
      );
    }),
  );
  return out;
}
