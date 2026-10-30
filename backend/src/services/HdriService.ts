// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/prisma';
import { storage } from '../lib/storage';
import { badRequest, notFound } from '../lib/errors';
import { ignoreFailure } from '../lib/ignoreFailure';

/**
 * Library of HDRI environments uploadable by admins (Phase 15 V4). Stored without migration in a key/value
 * setting (`Setting` `hdriLibrary`, JSON); the files live in MinIO under
 * `studio/hdris/`. The 3D Three viewer loads these HDRIs as environment.
 */

const SETTING_KEY = 'hdriLibrary';
export const HDRI_FORMATS = ['hdr', 'exr'] as const;
export type HdriFormat = (typeof HDRI_FORMATS)[number];

export interface HdriEntry {
  id: string;
  name: string;
  storageKey: string;
  format: HdriFormat;
  createdAt: string;
}

async function readLibrary(): Promise<HdriEntry[]> {
  const setting = await prisma.setting.findUnique({ where: { key: SETTING_KEY } });
  if (!setting) return [];
  try {
    const parsed = JSON.parse(setting.value) as HdriEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeLibrary(entries: HdriEntry[]): Promise<void> {
  const value = JSON.stringify(entries);
  await prisma.setting.upsert({
    where: { key: SETTING_KEY },
    update: { value },
    create: { key: SETTING_KEY, value },
  });
}

/** List of the HDRIs with a presigned read URL (for the viewer). */
export async function listWithUrls(): Promise<(HdriEntry & { url: string })[]> {
  const entries = await readLibrary();
  return Promise.all(
    entries.map(async (e) => ({ ...e, url: await storage.getPresignedGetUrl(e.storageKey) })),
  );
}

/**
 * An HDRI by its identifier, presigned — `null` if the library no longer knows it.
 *
 * `listWithUrls` would sign the whole library just to serve one: acceptable on the administration screen that
 * displays them all, not on the public sharing page, where a media is opened and every signature counts.
 */
export async function findWithUrl(id: string): Promise<(HdriEntry & { url: string }) | null> {
  const entry = (await readLibrary()).find((e) => e.id === id);
  return entry ? { ...entry, url: await storage.getPresignedGetUrl(entry.storageKey) } : null;
}

/** Presigned upload URL for a new HDRI (admin): returns the key + the PUT URL. */
export async function presignUpload(format: HdriFormat): Promise<{ storageKey: string; uploadUrl: string }> {
  if (!HDRI_FORMATS.includes(format)) throw badRequest('Invalid HDRI format (hdr or exr)', 'BAD_FORMAT');
  const storageKey = `studio/hdris/${randomUUID()}.${format}`;
  const contentType = format === 'exr' ? 'image/x-exr' : 'image/vnd.radiance';
  const uploadUrl = await storage.getPresignedPutUrl(storageKey, contentType);
  return { storageKey, uploadUrl };
}

/** Finalises the addition after the MinIO upload (admin). */
export async function add(name: string, storageKey: string, format: HdriFormat): Promise<HdriEntry> {
  if (!storageKey.startsWith('studio/hdris/')) throw badRequest('Invalid storage key', 'BAD_KEY');
  const entry: HdriEntry = {
    id: randomUUID(),
    name,
    storageKey,
    format,
    createdAt: new Date().toISOString(),
  };
  const entries = await readLibrary();
  await writeLibrary([...entries, entry]);
  return entry;
}

/** Deletes an HDRI (admin): removes the entry + the MinIO object. */
export async function remove(id: string): Promise<void> {
  const entries = await readLibrary();
  const target = entries.find((e) => e.id === id);
  if (!target) throw notFound('HDRI not found');
  await writeLibrary(entries.filter((e) => e.id !== id));
  await storage
    .deleteObject(target.storageKey)
    .catch(ignoreFailure('HDRI object cleanup failed', { key: target.storageKey }));
}
