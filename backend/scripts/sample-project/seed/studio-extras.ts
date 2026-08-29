// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Prisma, type PrismaClient } from '@prisma/client';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { makeStill } from '../build/video';
import type { ProjectSpec } from '../data/types';
import { filmOf } from './media-files';
import * as ApiTokenService from '../../../src/services/ApiTokenService';
import * as HdriService from '../../../src/services/HdriService';
import * as ReviewReferenceService from '../../../src/services/ReviewReferenceService';
import { storage } from '../../../src/services/StorageService';
import { fetchPolyHavenHdri } from '../build/models';
import { POLY_HAVEN_HDRIS } from '../config';
import type { SeededStudio } from './studio';

/**
 * Ce qui appartient au studio et non à un projet : bibliothèque d'éclairage, jetons d'API,
 * traces d'audit, et les images de référence épinglées dans une review.
 *
 * Ces éléments sont rarement peuplés dans un jeu de démonstration, et ce sont pourtant eux
 * qu'on cherche en premier quand on évalue l'outil : « est-ce que je peux éclairer un
 * modèle ? », « est-ce qu'une ferme de rendu peut publier toute seule ? ».
 */

/** Bibliothèque HDRI du studio : trois éclairages, du plein soleil à la nuit. */
export async function seedHdris(): Promise<number> {
  let added = 0;
  const existing = await HdriService.listWithUrls();
  for (const slug of POLY_HAVEN_HDRIS) {
    const name = slug.replace(/_/g, ' ');
    if (existing.some((entry: { name: string }) => entry.name === name)) continue;
    const file = await fetchPolyHavenHdri(slug);
    const format = basename(file).endsWith('.exr') ? 'exr' : 'hdr';
    const { storageKey } = await HdriService.presignUpload(format);
    await storage.uploadFile(storageKey, file, 'image/vnd.radiance');
    await HdriService.add(name, storageKey, format);
    added += 1;
  }
  return added;
}

/**
 * Jetons d'API : un personnel pour la pipeline TD, un de service pour la ferme de rendu.
 *
 * Les secrets sont affichés une seule fois à la création — comme dans l'interface. On les
 * renvoie pour que la génération les imprime : sans cela, la démonstration de l'API v1
 * demanderait d'en créer un à la main.
 */
export async function seedApiTokens(
  prisma: PrismaClient,
  studio: SeededStudio,
): Promise<{ label: string; token: string }[]> {
  const created: { label: string; token: string }[] = [];
  const ada = studio.users.get('ada');
  if (!ada) return created;

  const existingPersonal = await prisma.apiToken.findFirst({
    where: { userId: ada.id, name: 'Pipeline scripts' },
  });
  if (!existingPersonal) {
    const result = await ApiTokenService.createPersonal(ada.id, {
      name: 'Pipeline scripts',
      scopes: ['projects:read', 'shots:read', 'tasks:read', 'versions:write', 'media:write'],
      expiresInDays: 180,
    });
    created.push({ label: 'Pipeline scripts (personal)', token: result.token });
  }

  const existingService = await prisma.apiToken.findFirst({ where: { name: 'Render farm' } });
  if (!existingService) {
    const result = await ApiTokenService.createService(ada.id, {
      name: 'Render farm',
      scopes: ['projects:read', 'shots:read', 'versions:write', 'media:write', 'events:read'],
      expiresInDays: 365,
    });
    created.push({ label: 'Render farm (service)', token: result.token });
  }
  return created;
}

/** Quelques traces d'audit : l'écran d'administration ne doit pas s'ouvrir vide. */
export async function seedAudit(prisma: PrismaClient, studio: SeededStudio): Promise<number> {
  const entries = [
    { key: 'ada', action: 'PROJECT_CREATE', entityType: 'Project', metadata: { slug: 'caminandes' } },
    {
      key: 'ada',
      action: 'USER_INVITE',
      entityType: 'User',
      metadata: { email: 'kenji.watanabe@sample.review' },
    },
    {
      key: 'ines',
      action: 'SHARE_CREATE',
      entityType: 'ShareLink',
      metadata: { label: 'Producer — weekly reel' },
    },
    {
      key: 'ada',
      action: 'USER_DISABLE',
      entityType: 'User',
      metadata: { email: 'victor.salas@sample.review' },
    },
    { key: 'marisol', action: 'VERSION_PUBLISH', entityType: 'Version', metadata: { shot: 'SH0420' } },
    { key: 'ada', action: 'HDRI_ADD', entityType: 'Setting', metadata: { name: 'moonless golf' } },
  ];
  let written = 0;
  for (const [index, entry] of entries.entries()) {
    const userId = studio.users.get(entry.key)?.id ?? null;
    const already = await prisma.auditLog.findFirst({ where: { action: entry.action, userId } });
    if (already) continue;
    await prisma.auditLog.create({
      data: {
        userId,
        action: entry.action,
        entityType: entry.entityType,
        metadata: entry.metadata,
        createdAt: new Date(Date.now() - (index + 1) * 36 * 3600000),
      },
    });
    written += 1;
  }
  return written;
}

/**
 * Épingle une référence sur les premiers retours annotés d'un projet.
 *
 * On vise les commentaires qui portent déjà un dessin : ce sont ceux qu'on ouvre, et une
 * image de référence n'a de sens qu'à côté d'un retour précis.
 */
export async function seedProjectReferences(
  prisma: PrismaClient,
  studio: SeededStudio,
  seeded: { spec: ProjectSpec; project: { id: number } },
): Promise<number> {
  const comments = await prisma.comment.findMany({
    where: {
      parentId: null,
      annotation: { not: Prisma.DbNull },
      media: {
        version: {
          OR: [
            { task: { shot: { projectId: seeded.project.id } } },
            { task: { asset: { projectId: seeded.project.id } } },
          ],
        },
      },
    },
    select: { id: true, mediaObjectId: true, userId: true },
    orderBy: { id: 'asc' },
    take: 2,
  });
  if (comments.length === 0) return 0;

  // La référence est tirée d'un autre plan du projet — et du film de **son** épisode. Prendre
  // le film du projet donnerait, pour un plan de l'épisode 1, une image de l'épisode 3 : le
  // genre de mélange qui décrédibilise tout le jeu de données en un coup d'œil.
  const shots = seeded.spec.sequences.flatMap((sequence) =>
    sequence.shots.map((shot) => ({ shot, episode: sequence.episode })),
  );
  const targets: { commentId: number; mediaObjectId: number; file: string; authorKey: string }[] = [];
  for (const [index, comment] of comments.entries()) {
    const entry = shots[(index + 3) % shots.length];
    if (!entry) continue;
    const { shot } = entry;
    const file = await makeStill({
      film: filmOf(seeded.spec, shot, entry.episode),
      at: shot.at + 2,
      out: `refs/${seeded.spec.slug}/reference-${index}.jpg`,
      width: 1280,
    });
    const authorKey =
      [...studio.users.entries()].find(([, user]) => user.id === comment.userId)?.[0] ?? 'marisol';
    targets.push({ commentId: comment.id, mediaObjectId: comment.mediaObjectId, file, authorKey });
  }
  return seedReviewReferences(prisma, studio, targets);
}

/**
 * Images de référence épinglées à un retour de review.
 *
 * C'est le geste courant du superviseur : « voilà ce que je veux, à côté de ce que tu as
 * fait ». La référence n'apparaît qu'à la sélection du commentaire porteur.
 */
export async function seedReviewReferences(
  prisma: PrismaClient,
  studio: SeededStudio,
  images: { commentId: number; mediaObjectId: number; file: string; authorKey: string }[],
): Promise<number> {
  let added = 0;
  for (const [index, image] of images.entries()) {
    const already = await prisma.reviewReference.findFirst({ where: { commentId: image.commentId } });
    if (already) continue;
    const user = studio.users.get(image.authorKey);
    if (!user) continue;
    const buffer = await readFile(image.file);
    const dataUrl = `data:image/jpeg;base64,${buffer.toString('base64')}`;
    await ReviewReferenceService.add(
      { id: user.id, role: user.role },
      image.mediaObjectId,
      dataUrl,
      image.commentId,
      { x: 1.04, y: 0.05 + index * 0.34, width: 0.28 },
    );
    added += 1;
  }
  return added;
}
