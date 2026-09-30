// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Slugification S3-safe : minuscules, accents retirés, espaces/symboles → tirets.
 * Utilisé pour les slugs de projet et les clés MinIO lisibles.
 */
export const slugify = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // diacritiques combinants
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/**
 * Slugifie un nom de fichier en préservant l'extension.
 * ex. « Mon Plan Final.MOV » → « mon-plan-final.mov »
 */
export const slugifyFilename = (filename: string): string => {
  const dot = filename.lastIndexOf('.');
  if (dot <= 0) return slugify(filename) || 'fichier';
  const base = slugify(filename.slice(0, dot)) || 'fichier';
  const ext = slugify(filename.slice(dot + 1));
  return ext ? `${base}.${ext}` : base;
};
