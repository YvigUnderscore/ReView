// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { prisma } from '../lib/prisma';
import { storage } from './StorageService';

/**
 * Cartographie du stockage MinIO (admin > Stockage) : parcourt le bucket et agrège
 * les objets par convention de clé (voir StorageService et le worker FFmpeg) pour
 * répondre à « où vit chaque type de fichier ? ». Les fonctions de classification
 * et d'agrégation sont pures (testées) ; seul `storageReport` touche MinIO/DB.
 */

/** Catégorie racine d'une clé objet (premier segment du chemin). */
export type StorageCategory =
  | 'originals' // projects/{slug}/… — fichiers uploadés (source de vérité)
  | 'derived' // derived/{mediaId}/… — dérivés générés par les workers
  | 'studio' // studio/hdris|ocio — bibliothèques studio
  | 'avatars' // avatars/{userId}.…
  | 'branding' // branding/logo-*.…
  | 'documents' // documents/… — PDF de la page Documents
  | 'comments' // comments/attachments/{userId}/… — pièces jointes & notes vocales
  | 'quarantine' // quarantine/{mediaId}/… — uploads infectés isolés (ClamAV)
  | 'other';

export interface StorageObjectInfo {
  key: string;
  size: number;
}

export interface StorageAgg {
  count: number;
  bytes: number;
}

export interface StorageReportData {
  totalObjects: number;
  totalBytes: number;
  /** Agrégat par catégorie racine. */
  categories: Record<string, StorageAgg>;
  /** Détail des dérivés (`derived/{id}/…`) par sous-type de fichier. */
  derived: Record<string, StorageAgg>;
  /** Détail des bibliothèques studio (hdris / ocio). */
  studio: Record<string, StorageAgg>;
  /** Occupation des originaux par slug de projet (`projects/{slug}/…`). */
  projects: { slug: string; objects: number; bytes: number }[];
}

/** Sous-type d'un dérivé (`derived/{mediaId}/<reste>`) d'après le nom de fichier. */
export function derivedSubtype(rest: string): string {
  if (rest.startsWith('hls/')) return 'hls';
  if (rest.startsWith('thumbnail.')) return 'thumbnails';
  if (rest === 'model.glb') return 'glb';
  if (rest === 'proxy.mp4' || rest === 'proxy-trim.mp4') return 'proxies';
  if (rest === 'client.mp4') return 'client';
  if (rest === 'timeline-sprite.jpg') return 'sprites';
  // `reference-{uuid}.{ext}` (Phase 24, multi) + `reference.png` legacy (référence unique).
  if (rest.startsWith('reference')) return 'references';
  if (rest === 'splat-mask.bin' || rest === 'splat-subset.bin') return 'splat-edits';
  return 'other';
}

/** Classe une clé objet MinIO selon les conventions de l'application. */
export function classifyKey(key: string): {
  category: StorageCategory;
  /** Sous-type (dérivés : hls/thumbnails/… ; studio : hdris/ocio). */
  sub?: string;
  /** Slug du projet pour les originaux (`projects/{slug}/…`). */
  projectSlug?: string;
} {
  const slash = key.indexOf('/');
  const head = slash === -1 ? key : key.slice(0, slash);
  const rest = slash === -1 ? '' : key.slice(slash + 1);
  switch (head) {
    case 'projects': {
      const slug = rest.split('/')[0] ?? '';
      return { category: 'originals', projectSlug: slug || undefined };
    }
    case 'derived': {
      // derived/{mediaId}/<fichier…> → sous-type d'après le fichier
      const afterId = rest.slice(rest.indexOf('/') + 1);
      return { category: 'derived', sub: derivedSubtype(rest.includes('/') ? afterId : rest) };
    }
    case 'studio':
      return { category: 'studio', sub: rest.split('/')[0] || 'other' };
    case 'avatars':
      return { category: 'avatars' };
    case 'branding':
      return { category: 'branding' };
    case 'documents':
      return { category: 'documents' };
    case 'comments':
      return { category: 'comments' };
    case 'quarantine':
      return { category: 'quarantine' };
    default:
      return { category: 'other' };
  }
}

const add = (m: Record<string, StorageAgg>, k: string, size: number) => {
  const agg = (m[k] ??= { count: 0, bytes: 0 });
  agg.count += 1;
  agg.bytes += size;
};

/** Agrège une liste d'objets (clé + taille) en rapport de cartographie. */
export function aggregateObjects(objects: Iterable<StorageObjectInfo>): StorageReportData {
  const categories: Record<string, StorageAgg> = {};
  const derived: Record<string, StorageAgg> = {};
  const studio: Record<string, StorageAgg> = {};
  const byProject: Record<string, StorageAgg> = {};
  let totalObjects = 0;
  let totalBytes = 0;
  for (const o of objects) {
    totalObjects += 1;
    totalBytes += o.size;
    const c = classifyKey(o.key);
    add(categories, c.category, o.size);
    if (c.category === 'derived') add(derived, c.sub ?? 'other', o.size);
    if (c.category === 'studio') add(studio, c.sub ?? 'other', o.size);
    if (c.category === 'originals' && c.projectSlug) add(byProject, c.projectSlug, o.size);
  }
  const projects = Object.entries(byProject)
    .map(([slug, agg]) => ({ slug, objects: agg.count, bytes: agg.bytes }))
    .sort((a, b) => b.bytes - a.bytes);
  return { totalObjects, totalBytes, categories, derived, studio, projects };
}

/**
 * Rapport complet : scan du bucket + croisement des slugs avec les projets connus
 * (id navigable, nom lisible ; un slug orphelin = projet purgé → signalé tel quel).
 */
export async function storageReport() {
  const objects: StorageObjectInfo[] = [];
  for await (const o of storage.iterateObjects()) objects.push(o);
  const report = aggregateObjects(objects);
  const known = await prisma.project.findMany({
    select: { id: true, slug: true, name: true, deletedAt: true },
  });
  const bySlug = new Map(known.map((p) => [p.slug, p]));
  return {
    ...report,
    projects: report.projects.map((p) => {
      const match = bySlug.get(p.slug);
      return {
        ...p,
        projectId: match?.id ?? null,
        name: match?.name ?? null,
        deleted: match ? match.deletedAt != null : false,
      };
    }),
    generatedAt: new Date().toISOString(),
  };
}
