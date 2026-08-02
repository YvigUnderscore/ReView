// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/prisma';
import { storage } from './StorageService';
import { badRequest, notFound } from '../lib/errors';

/**
 * Bibliothèque d'environnements HDRI uploadables en admin (Phase 15 V4). Stockée sans
 * migration dans un réglage clé/valeur (`Setting` `hdriLibrary`, JSON) ; les fichiers vivent
 * dans MinIO sous `studio/hdris/`. Le viewer 3D Three chargera ces HDRI comme environnement.
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

/** Liste des HDRI avec URL présignée de lecture (pour le viewer). */
export async function listWithUrls(): Promise<(HdriEntry & { url: string })[]> {
  const entries = await readLibrary();
  return Promise.all(
    entries.map(async (e) => ({ ...e, url: await storage.getPresignedGetUrl(e.storageKey) })),
  );
}

/** URL présignée d'upload d'un nouveau HDRI (admin) : renvoie la clé + l'URL PUT. */
export async function presignUpload(format: HdriFormat): Promise<{ storageKey: string; uploadUrl: string }> {
  if (!HDRI_FORMATS.includes(format)) throw badRequest('Format HDRI invalide (hdr/exr)', 'BAD_FORMAT');
  const storageKey = `studio/hdris/${randomUUID()}.${format}`;
  const contentType = format === 'exr' ? 'image/x-exr' : 'image/vnd.radiance';
  const uploadUrl = await storage.getPresignedPutUrl(storageKey, contentType);
  return { storageKey, uploadUrl };
}

/** Finalise l'ajout après upload MinIO (admin). */
export async function add(name: string, storageKey: string, format: HdriFormat): Promise<HdriEntry> {
  if (!storageKey.startsWith('studio/hdris/')) throw badRequest('Clé de stockage invalide', 'BAD_KEY');
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

/** Supprime un HDRI (admin) : retire l'entrée + l'objet MinIO. */
export async function remove(id: string): Promise<void> {
  const entries = await readLibrary();
  const target = entries.find((e) => e.id === id);
  if (!target) throw notFound('HDRI introuvable');
  await writeLibrary(entries.filter((e) => e.id !== id));
  await storage.deleteObject(target.storageKey).catch(() => undefined);
}
