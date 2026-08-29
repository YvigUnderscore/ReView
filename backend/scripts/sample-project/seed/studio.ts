// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { PrismaClient, Studio, User } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { storage } from '../../../src/services/StorageService';
import { makeAvatar, makeDepartmentBadge } from '../build/images';
import { SAMPLE_PASSWORD, STUDIO_FPS, STUDIO_RESOLUTION } from '../config';
import { DEPARTMENTS, SERVICE_ACCOUNT, TEAM } from '../data/team';
import type { TeamMember } from '../data/types';

/**
 * Socle du studio : personnes, départements, vocabulaire de review, modèles de fiche,
 * annonces.
 *
 * Tout est idempotent — la génération se relance sans jamais dupliquer un compte ni une
 * étape de pipeline. Les avatars et les pastilles de département sont fabriqués puis
 * déposés directement dans le stockage objet : ce sont des images d'habillage, elles n'ont
 * pas à traverser la file de traitement des médias.
 */

export interface SeededStudio {
  studio: Studio;
  /** Clé de membre → utilisateur en base. */
  users: Map<string, User>;
  /** Clé de département → identifiant. */
  departments: Map<string, number>;
  /** Nom du statut de review → identifiant. */
  reviewStatuses: Map<string, number>;
}

/** Initiales affichées sur l'avatar. */
const initialsOf = (member: TeamMember): string =>
  `${member.firstName.charAt(0)}${member.lastName.charAt(0)}`.toUpperCase();

async function upsertMember(prisma: PrismaClient, member: TeamMember, password: string): Promise<User> {
  const avatarPath = await makeAvatar(
    initialsOf(member),
    member.avatar ?? ['#3A4150', '#171A21'],
    `avatars/${member.key}.png`,
  );
  const avatarKey = `avatars/sample-${member.key}.png`;
  await storage.uploadFile(avatarKey, avatarPath, 'image/png');

  const data = {
    firstName: member.firstName,
    lastName: member.lastName,
    name: `${member.firstName} ${member.lastName}`,
    username: member.username,
    jobTitle: member.jobTitle,
    bio: member.bio,
    ...(member.phone ? { phone: member.phone } : {}),
    avatarKey,
    role: member.role,
    isService: member.service === true,
    disabledAt: member.disabled === true ? new Date(Date.now() - 21 * 86400000) : null,
  };
  return prisma.user.upsert({
    where: { email: member.email },
    update: data,
    create: { email: member.email, password, ...data },
  });
}

/** Statuts de review du studio (décision posée sur une version). */
const REVIEW_STATUSES = [
  { name: 'Pending', color: '#F5A623', order: 0, isDefault: true, isApproval: false, isRetake: false },
  { name: 'Approved', color: '#2ECC71', order: 1, isDefault: false, isApproval: true, isRetake: false },
  { name: 'Retake', color: '#E74C3C', order: 2, isDefault: false, isApproval: false, isRetake: true },
  { name: 'CBB', color: '#3498DB', order: 3, isDefault: false, isApproval: false, isRetake: false },
];

/** Modèles de fiche proposés à la création d'un plan ou d'un asset. */
const NOTE_TEMPLATES = [
  {
    name: 'Shot brief',
    scope: 'shot',
    body: `# {SHOT} — brief

::small Frame range · lens · length

## Intent

What the shot has to do in the cut. One paragraph, no more.

## Continuity

- What must match the shot before.
- What must match the shot after.

## Status

::progress Layout 0 %
::progress Animation 0 %
::progress Lighting 0 %
::progress Compositing 0 %
`,
  },
  {
    name: 'Asset brief',
    scope: 'asset',
    body: `# {ASSET}

::small Type · used in N shots · library path

## Build notes

- Topology and scale constraints.
- Variants expected, and which one is the default.
- What ships with the asset (proxy, cache, textures).

## Review checklist

- [ ] Reads at quarter size
- [ ] Proxy exported
- [ ] Named to the show convention
`,
  },
  {
    name: 'Sequence brief',
    scope: 'sequence',
    body: `# {SEQUENCE}

::small N shots · location · time of day

## Intent

## Continuity rules

## Status

::progress Animation 0 %
::progress Lighting 0 %
`,
  },
];

/** Annonces affichées à l'ouverture de l'application. */
const ANNOUNCEMENTS = [
  {
    title: 'Sample project — everything here is open source',
    body: 'Footage comes from the Blender Open Movies (CC BY), models and HDRIs from Poly Haven (CC0). See ATTRIBUTION.md at the root of the repository for the full credit list.',
    type: 'INFO' as const,
    frequency: 'FIRST_OF_DAY' as const,
  },
  {
    title: 'Friday dailies moved to 10:00',
    body: 'The Sintel daily now starts at 10:00 in the theatre room. Playlists are posted the evening before.',
    type: 'INFO' as const,
    frequency: 'PERMANENT' as const,
  },
  {
    title: 'Storage maintenance on Saturday',
    body: 'The render farm cache will be pruned on Saturday morning. Published versions are never touched; drafts older than 90 days will be removed.',
    type: 'MAINTENANCE' as const,
    frequency: 'PERMANENT' as const,
  },
];

export async function seedStudio(prisma: PrismaClient): Promise<SeededStudio> {
  const studio = await prisma.studio.upsert({
    where: { slug: 'review-studio' },
    update: {},
    create: { name: 'ReView Studio', slug: 'review-studio' },
  });

  // Défauts de projet du studio : ce dont hérite tout nouveau projet.
  await prisma.setting.upsert({
    where: { key: 'project_defaults' },
    update: {
      value: JSON.stringify({
        departments: DEPARTMENTS.map((d) => ({ key: d.key, name: d.name })),
        nomenclature: { sequencePrefix: 'SQ', shotPrefix: 'SH', padding: 4, step: 10 },
        naming: { pattern: '', mode: 'off' },
        resolution: STUDIO_RESOLUTION,
        framerate: STUDIO_FPS,
      }),
    },
    create: {
      key: 'project_defaults',
      value: JSON.stringify({
        departments: DEPARTMENTS.map((d) => ({ key: d.key, name: d.name })),
        nomenclature: { sequencePrefix: 'SQ', shotPrefix: 'SH', padding: 4, step: 10 },
        naming: { pattern: '', mode: 'off' },
        resolution: STUDIO_RESOLUTION,
        framerate: STUDIO_FPS,
      }),
    },
  });

  const departments = new Map<string, number>();
  for (const [index, department] of DEPARTMENTS.entries()) {
    const badgePath = await makeDepartmentBadge(
      department.key.slice(0, 4),
      department.color,
      `departments/${department.key}.png`,
    );
    const imageKey = `departments/sample-${department.key.toLowerCase()}.png`;
    await storage.uploadFile(imageKey, badgePath, 'image/png');
    const existing = await prisma.department.findFirst({
      where: { studioId: studio.id, projectId: null, key: department.key },
    });
    const record = existing
      ? await prisma.department.update({
          where: { id: existing.id },
          data: { name: department.name, order: index, color: department.color, imageKey, deletedAt: null },
        })
      : await prisma.department.create({
          data: {
            studioId: studio.id,
            key: department.key,
            name: department.name,
            order: index,
            color: department.color,
            imageKey,
          },
        });
    departments.set(department.key, record.id);
  }

  const password = await bcrypt.hash(SAMPLE_PASSWORD, 12);
  const users = new Map<string, User>();
  for (const member of [...TEAM, SERVICE_ACCOUNT]) {
    const user = await upsertMember(prisma, member, password);
    users.set(member.key, user);
    const wanted = member.departments
      .map((key) => departments.get(key))
      .filter((id): id is number => Boolean(id));
    await prisma.user.update({
      where: { id: user.id },
      data: { departments: { set: wanted.map((id) => ({ id })) } },
    });
  }

  const reviewStatuses = new Map<string, number>();
  for (const status of REVIEW_STATUSES) {
    const record = await prisma.reviewStatus.upsert({
      where: { name: status.name },
      update: { color: status.color, order: status.order },
      create: status,
    });
    reviewStatuses.set(status.name, record.id);
  }

  for (const template of NOTE_TEMPLATES) {
    const existing = await prisma.noteTemplate.findFirst({
      where: { studioId: studio.id, projectId: null, name: template.name },
    });
    if (existing) {
      await prisma.noteTemplate.update({ where: { id: existing.id }, data: { body: template.body } });
    } else {
      await prisma.noteTemplate.create({
        data: {
          studioId: studio.id,
          name: template.name,
          scope: template.scope,
          body: template.body,
          createdById: users.get('ada')?.id ?? null,
        },
      });
    }
  }

  for (const announcement of ANNOUNCEMENTS) {
    const existing = await prisma.announcement.findFirst({ where: { title: announcement.title } });
    if (!existing) await prisma.announcement.create({ data: { ...announcement, roles: [] } });
  }

  return { studio, users, departments, reviewStatuses };
}
