// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Role } from '@prisma/client';
import { badRequest } from '../lib/errors';
import { checkProjectAccess } from '../middleware/rbac';
import { storage } from './StorageService';
import { NOTE_KINDS, resolveProject, type NoteKind } from './EntityNoteService';

/**
 * Les images qu'une fiche porte elle-même.
 *
 * Une fiche ne pouvait montrer que des images déjà en ligne ailleurs : on collait une URL,
 * et la planche mourait avec le serveur d'en face. Les images vivent donc désormais dans le
 * bucket, déposées comme une vignette d'entité — présignature, puis PUT direct depuis le
 * navigateur, sans jamais traverser l'API.
 *
 * Ce qui est **écrit dans la fiche est la clé**, pas une URL : une URL présignée expire au
 * bout d'une heure, et un brief se relit six mois plus tard. Le texte reste donc stable, et
 * `resolveMany` refait des URL de lecture à chaque affichage.
 *
 * La clé porte l'entité (`note-images/{kind}/{id}/…`) et c'est elle qui décide de l'accès :
 * lire l'image d'un plan revient à lire ce plan, donc à être membre de son projet. Sans ce
 * contrôle, une clé devinée aurait suffi à sortir la planche d'un projet fermé.
 */

export const NOTE_IMAGE_PREFIX = 'note-images/';

/** Nombre de clés résolues d'un coup — une planche entière tient largement dedans. */
export const MAX_RESOLVE_KEYS = 80;

const EXTENSIONS: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/avif': '.avif',
};

/** Le nom déposé sert de repère humain dans le bucket — il ne décide de rien. */
function safeName(filename: string): string {
  const base = filename.replace(/\.[^.]*$/, '').replace(/[^a-zA-Z0-9._-]/g, '_');
  return base.slice(0, 60) || 'image';
}

/**
 * L'entité désignée par une clé, ou `null` si la clé n'est pas une image de fiche.
 *
 * Fonction pure, et volontairement stricte : un identifiant non numérique, un segment de
 * plus, un `..` — tout ce qui ne ressemble pas exactement à la convention est refusé plutôt
 * qu'interprété. C'est ce qui rend le contrôle d'accès en aval fiable.
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

/** La clé d'une image à déposer — calculée ici, jamais reçue du client. */
export function buildNoteImageKey(kind: NoteKind, id: number, filename: string, contentType: string) {
  const ext = EXTENSIONS[contentType];
  if (!ext) throw badRequest('Unsupported image type', 'BAD_CONTENT_TYPE');
  return `${NOTE_IMAGE_PREFIX}${kind}/${id}/${Date.now()}-${safeName(filename)}${ext}`;
}

/**
 * URL de dépôt, et l'URL de lecture qui va avec.
 *
 * La seconde évite un aller-retour : l'image doit s'afficher dans l'éditeur à la seconde
 * où elle est déposée, sinon on croit que le dépôt a échoué et on recommence.
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
 * Les URL de lecture d'un lot de clés.
 *
 * Les clés sont groupées par entité pour ne vérifier l'accès qu'une fois par plan : une
 * planche de vingt images ne doit pas coûter vingt requêtes d'appartenance. Une clé
 * étrangère à la convention est ignorée sans erreur — une fiche ancienne peut encore
 * pointer vers l'extérieur, et ce n'est pas une faute.
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
      // Une entité disparue ne fait pas échouer le lot : une fiche peut citer l'image d'un
      // plan supprimé depuis, et refuser tout le lot ferait disparaître les vingt images
      // valides de la planche pour une référence morte.
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
