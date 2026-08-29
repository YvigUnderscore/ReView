// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Prisma, PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { dayOffset } from '../generate';
import { makeRng } from '../lib/rng';
import type { SeededProject } from './project';
import type { SeededStudio } from './studio';

/**
 * Ce qui entoure la review : playlists de dailies, liens de partage client, montages,
 * tableaux de références, favoris et notifications.
 *
 * Sans ces éléments, l'application s'ouvre sur une hiérarchie muette. Ce sont eux qui
 * donnent l'impression d'un studio en activité : un daily prêt pour demain matin, un lien
 * envoyé au producteur la semaine dernière, un montage de séquence figé avant la projection.
 */

/**
 * Élément Excalidraw : les champs que le canvas attend, avec des valeurs stables.
 *
 * Les couleurs sont celles de la palette **claire** d'Excalidraw, y compris pour un studio
 * en thème sombre : le canvas inverse lui-même les teintes quand le thème l'est. Écrire du
 * texte clair « pour le sombre » donne du texte noir sur fond noir.
 */
function boardElement(
  index: number,
  overrides: Record<string, unknown> & { type: string; x: number; y: number },
): Record<string, unknown> {
  return {
    id: `sample-${index}`,
    angle: 0,
    strokeColor: '#1e1e1e',
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    strokeWidth: 1,
    strokeStyle: 'solid',
    roughness: 0,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: 100000 + index * 7919,
    version: 1,
    versionNonce: 200000 + index * 104729,
    isDeleted: false,
    boundElements: null,
    updated: 1,
    link: null,
    locked: false,
    ...overrides,
  };
}

/** Bloc de texte du tableau. */
function boardText(index: number, x: number, y: number, text: string, size = 20): Record<string, unknown> {
  const lines = text.split('\n');
  return boardElement(index, {
    type: 'text',
    x,
    y,
    width: Math.max(...lines.map((l) => l.length)) * size * 0.52,
    height: lines.length * size * 1.25,
    text,
    originalText: text,
    fontSize: size,
    fontFamily: 2,
    textAlign: 'left',
    verticalAlign: 'top',
    containerId: null,
    lineHeight: 1.25,
    autoResize: true,
  });
}

/** Teintes de remplissage d'Excalidraw, appariées à leurs traits. */
const CARD_FILL: Record<string, string> = {
  '#1971c2': '#a5d8ff',
  '#e03131': '#ffc9c9',
  '#2f9e44': '#b2f2bb',
  '#f08c00': '#ffec99',
  '#9c36b5': '#eebefa',
  '#0c8599': '#99e9f2',
};

/** Cartouche coloré derrière un bloc de texte. */
function boardCard(
  index: number,
  x: number,
  y: number,
  width: number,
  height: number,
  colour: string,
): Record<string, unknown> {
  return boardElement(index, {
    type: 'rectangle',
    x: x - 18,
    y: y - 18,
    width,
    height,
    strokeColor: colour,
    backgroundColor: CARD_FILL[colour] ?? 'transparent',
    fillStyle: 'solid',
    roundness: { type: 3 },
  });
}

/** Tableau du projet : le brief, puis une colonne par séquence. */
async function seedProjectBoard(prisma: PrismaClient, seeded: SeededProject): Promise<void> {
  const elements: Record<string, unknown>[] = [];
  let index = 0;
  elements.push(boardText(index++, 60, 40, seeded.spec.name.toUpperCase(), 42));
  elements.push(boardText(index++, 60, 110, seeded.spec.description, 16));

  const brief = (seeded.spec.brief ?? '')
    .split('\n')
    .filter((line) => line.trim() && !line.startsWith('::') && !line.startsWith('#'))
    .slice(0, 8)
    .join('\n');
  if (brief) {
    elements.push(boardCard(index++, 60, 190, 720, 240, '#1971c2'));
    elements.push(boardText(index++, 60, 190, brief, 15));
  }

  const palette = ['#e03131', '#2f9e44', '#f08c00', '#9c36b5', '#0c8599'];
  seeded.spec.sequences.forEach((sequence, position) => {
    const x = 60 + position * 300;
    const y = 480;
    const colour = palette[position % palette.length]!;
    const body = [
      sequence.name,
      '',
      ...sequence.shots.slice(0, 8).map((shot) => `${shot.code}  ${shot.stage}`),
    ].join('\n');
    elements.push(boardCard(index++, x, y, 268, 300, colour));
    elements.push(boardText(index++, x, y, `${sequence.code}\n${body}`, 15));
  });

  // Pas de couleur de fond imposée : le canvas suit le thème du studio.
  const document = { elements, files: {}, appState: {} };
  await prisma.board.upsert({
    where: { projectId: seeded.project.id },
    update: { document: document as unknown as Prisma.InputJsonValue },
    create: { projectId: seeded.project.id, document: document as unknown as Prisma.InputJsonValue },
  });
}

/** Playlists de dailies : la dernière version publiée de chaque plan retenu. */
async function seedPlaylists(
  prisma: PrismaClient,
  studio: SeededStudio,
  seeded: SeededProject,
): Promise<number> {
  let count = 0;
  for (const spec of seeded.spec.playlists ?? []) {
    const playlist = await prisma.playlist.upsert({
      where: { projectId_name: { projectId: seeded.project.id, name: spec.name } },
      update: {},
      create: {
        projectId: seeded.project.id,
        name: spec.name,
        createdById: studio.users.get(spec.createdBy)?.id ?? null,
        createdAt: dayOffset(120),
      },
    });
    let order = 0;
    for (const code of spec.shots) {
      const shot = seeded.shots.get(code);
      if (!shot) continue;
      const versions = seeded.versions
        .filter((v) => v.shot?.id === shot.id && v.version.published)
        .sort((a, b) => b.planned.createdAt.getTime() - a.planned.createdAt.getTime());
      const chosen = versions[0];
      if (!chosen) continue;
      await prisma.playlistItem.upsert({
        where: { playlistId_versionId: { playlistId: playlist.id, versionId: chosen.version.id } },
        update: { order },
        create: { playlistId: playlist.id, versionId: chosen.version.id, order },
      });
      order += 1;
    }
    count += 1;
  }
  return count;
}

/** Liens de partage client, avec leur portée réelle. */
async function seedShares(
  prisma: PrismaClient,
  studio: SeededStudio,
  seeded: SeededProject,
): Promise<number> {
  let count = 0;
  for (const spec of seeded.spec.shares ?? []) {
    const existing = await prisma.shareLink.findFirst({
      where: { projectId: seeded.project.id, label: spec.label },
    });
    if (existing) {
      count += 1;
      continue;
    }
    const playlist = spec.playlist
      ? await prisma.playlist.findFirst({ where: { projectId: seeded.project.id, name: spec.playlist } })
      : null;
    await prisma.shareLink.create({
      data: {
        token: randomBytes(24).toString('hex'),
        projectId: seeded.project.id,
        label: spec.label,
        permission: spec.permission,
        scope: spec.scope,
        ...(playlist ? { playlistId: playlist.id } : {}),
        ...(spec.password ? { passwordHash: await bcrypt.hash('sample1234', 12) } : {}),
        ...(spec.maxViews ? { maxViews: spec.maxViews } : {}),
        ...(spec.expiresInDays ? { expiresAt: new Date(Date.now() + spec.expiresInDays * 86400000) } : {}),
        createdById: studio.users.get(spec.createdBy)?.id ?? null,
        createdAt: dayOffset(118),
        viewCount: 3,
        lastViewedAt: dayOffset(126),
      },
    });
    count += 1;
  }
  return count;
}

/**
 * Montages : celui du projet entier, et un par séquence.
 *
 * Leur contenu n'est jamais stocké — il est recalculé à chaque lecture. Ce qui est écrit ici
 * est ce qu'un humain a décidé : le nom, le département visé, et une révision figée avant la
 * projection de la semaine.
 */
async function seedTimelines(
  prisma: PrismaClient,
  studio: SeededStudio,
  seeded: SeededProject,
): Promise<number> {
  let count = 0;
  // Le montage de projet a `sequenceId` à null : Prisma refuse un `upsert` sur une clé
  // composée qui contient un NULL, il faut donc lire puis créer.
  const project =
    (await prisma.timeline.findFirst({ where: { projectId: seeded.project.id, sequenceId: null } })) ??
    (await prisma.timeline.create({ data: { projectId: seeded.project.id } }));
  count += 1;

  for (const [code, sequence] of seeded.sequences) {
    const existing = await prisma.timeline.findFirst({
      where: { projectId: seeded.project.id, sequenceId: sequence.id },
    });
    if (!existing) {
      await prisma.timeline.create({
        data: {
          projectId: seeded.project.id,
          sequenceId: sequence.id,
          name: `${code} edit`,
          department: null,
        },
      });
    }
    count += 1;
  }

  // Une révision figée du montage de projet : ce qui a été montré à la projection.
  const hasSnapshot = await prisma.timelineSnapshot.findFirst({ where: { timelineId: project.id } });
  if (!hasSnapshot) {
    const items = seeded.versions
      .filter((v) => v.shot && v.version.published)
      .slice(0, 12)
      .map((entry, order) => ({
        order,
        shotId: entry.shot!.id,
        shotCode: entry.shot!.code,
        sequenceCode:
          [...seeded.sequences.entries()].find(([, s]) => s.id === entry.shot!.sequenceId)?.[0] ?? null,
        versionId: entry.version.id,
        versionName: entry.version.name,
        department: entry.planned.department,
        duration: 5,
      }));
    if (items.length > 0) {
      await prisma.timelineSnapshot.create({
        data: {
          timelineId: project.id,
          revision: 1,
          note: 'Screening cut — week 33',
          createdById: studio.users.get('ines')?.id ?? null,
          createdAt: dayOffset(122),
          items: { create: items },
        },
      });
    }
  }
  return count;
}

/** Favoris, suivis et notifications : ce qui fait qu'un compte a une histoire. */
async function seedPersonal(
  prisma: PrismaClient,
  studio: SeededStudio,
  seeded: SeededProject,
): Promise<void> {
  const rng = makeRng(`${seeded.spec.slug}:personal`);
  const members = seeded.spec.team.map((t) => t.member);
  const shots = [...seeded.shots.values()];
  const assets = [...seeded.assets.values()];

  for (const key of members) {
    const user = studio.users.get(key);
    if (!user) continue;
    await prisma.favorite.upsert({
      where: { userId_type_entityId: { userId: user.id, type: 'PROJECT', entityId: seeded.project.id } },
      update: {},
      create: { userId: user.id, type: 'PROJECT', entityId: seeded.project.id },
    });
    for (const shot of rng.sample(shots, Math.min(2, shots.length))) {
      await prisma.favorite.upsert({
        where: { userId_type_entityId: { userId: user.id, type: 'SHOT', entityId: shot.id } },
        update: {},
        create: { userId: user.id, type: 'SHOT', entityId: shot.id },
      });
      await prisma.watch.upsert({
        where: { userId_targetType_targetId: { userId: user.id, targetType: 'SHOT', targetId: shot.id } },
        update: {},
        create: { userId: user.id, targetType: 'SHOT', targetId: shot.id },
      });
    }
    for (const asset of rng.sample(assets, Math.min(1, assets.length))) {
      await prisma.watch.upsert({
        where: { userId_targetType_targetId: { userId: user.id, targetType: 'ASSET', targetId: asset.id } },
        update: {},
        create: { userId: user.id, targetType: 'ASSET', targetId: asset.id },
      });
    }
  }

  // Notifications : celles qu'un membre trouve en arrivant le matin.
  const assigned = seeded.versions.filter((v) => v.planned.comments.some((c) => c.assigneeKey)).slice(0, 8);
  for (const entry of assigned) {
    for (const comment of entry.planned.comments) {
      if (!comment.assigneeKey) continue;
      const user = studio.users.get(comment.assigneeKey);
      if (!user) continue;
      const existing = await prisma.notification.findFirst({
        where: { userId: user.id, type: 'COMMENT_ASSIGNED', content: { contains: entry.ownerCode } },
      });
      if (existing) continue;
      await prisma.notification.create({
        data: {
          userId: user.id,
          type: 'COMMENT_ASSIGNED',
          content: `A review note on ${entry.ownerCode} was assigned to you`,
          projectId: seeded.project.id,
          isRead: rng.chance(0.4),
          createdAt: comment.createdAt,
        },
      });
    }
  }
}

export interface ExtrasResult {
  playlists: number;
  shares: number;
  timelines: number;
}

export async function seedExtras(
  prisma: PrismaClient,
  studio: SeededStudio,
  seeded: SeededProject,
): Promise<ExtrasResult> {
  await seedProjectBoard(prisma, seeded);
  const playlists = await seedPlaylists(prisma, studio, seeded);
  const shares = await seedShares(prisma, studio, seeded);
  const timelines = await seedTimelines(prisma, studio, seeded);
  await seedPersonal(prisma, studio, seeded);
  return { playlists, shares, timelines };
}
