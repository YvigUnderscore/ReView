// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Role, MediaKind, MediaStatus, Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { searchComments, type CommentHit } from './searchComments';

/**
 * Recherche globale multi-entités (palette Ctrl+K).
 *
 * Dix types, pas cinq : ce qu'un superviseur tape le plus souvent est un nom de version ou
 * de média (`SH0120_comp_v012`), et ce qu'il cherche vraiment est parfois une phrase dite en
 * review (« enlever le reflet ») — cf. `searchComments`, plein texte Postgres.
 *
 * **Cloisonnement.** Chaque type porte son propre filtre d'accès, écrit dans la clause
 * `where` et jamais après coup :
 *  - ADMIN / SUPERVISOR globaux voient tout le studio ;
 *  - les autres ne voient que les projets dont ils sont membres ;
 *  - un média non publié n'appartient qu'à son déposant ;
 *  - un CLIENT ne voit ni les brouillons des autres, ni les notes internes, ni l'annuaire
 *    du studio hors des projets qu'il partage.
 * La corbeille (`deletedAt`) est exclue partout.
 */

/**
 * Nombre de résultats par type. Les types dont le volume suit la production (shots,
 * versions, médias, notes) en méritent plus que les référentiels courts (projets, playlists,
 * personnes) — la palette reste néanmoins bornée, à la frappe comme au rendu.
 */
export const SEARCH_LIMITS = {
  projects: 5,
  sequences: 5,
  shots: 8,
  assets: 5,
  tasks: 5,
  versions: 8,
  media: 8,
  playlists: 5,
  comments: 8,
  people: 5,
} as const;

export interface SearchResults {
  projects: { id: number; name: string }[];
  sequences: { id: number; code: string; name: string; projectId: number }[];
  shots: { id: number; code: string; name: string; projectId: number }[];
  assets: { id: number; name: string; type: string; projectId: number }[];
  tasks: { id: number; name: string; type: string; shotId: number | null; assetId: number | null }[];
  versions: {
    id: number;
    name: string;
    /** Média visible le plus récent — cible de navigation quand il existe. */
    mediaId: number | null;
    taskId: number | null;
    assetId: number | null;
    context: string;
  }[];
  media: { id: number; name: string; kind: MediaKind; context: string }[];
  playlists: { id: number; name: string; projectName: string }[];
  comments: CommentHit[];
  /** `name` vaut `null` quand le compte n'a ni pseudo ni nom — l'écran s'en charge. */
  people: { id: number; name: string | null; jobTitle: string | null }[];
}

/** Rôles qui voient le studio entier, membership ignoré (cf. `lib/projectRoles`). */
const isGlobalRole = (role: Role): boolean => role === Role.ADMIN || role === Role.SUPERVISOR;

/** Projets lisibles par le demandeur — la brique que tous les autres filtres réutilisent. */
export function projectScope(userId: number, role: Role): Prisma.ProjectWhereInput {
  return isGlobalRole(role) ? { deletedAt: null } : { deletedAt: null, memberships: { some: { userId } } };
}

/** Versions lisibles : celles dont le plan ou l'asset porteur est dans un projet accessible. */
function versionScope(project: Prisma.ProjectWhereInput): Prisma.VersionWhereInput {
  return {
    deletedAt: null,
    OR: [
      { task: { shot: { deletedAt: null, project } } },
      { task: { asset: { deletedAt: null, project } } },
      { asset: { deletedAt: null, project } },
    ],
  };
}

/**
 * Médias montrables : prêts et publiés — un brouillon n'est visible que de son déposant, et
 * jamais d'un CLIENT (qui n'en dépose aucun). Ce filtre-ci ne dit rien du projet : il sert
 * aussi bien à la recherche de médias qu'à la sélection du média d'une version déjà filtrée.
 */
function mediaVisibility(userId: number, role: Role): Prisma.MediaObjectWhereInput {
  return {
    deletedAt: null,
    status: MediaStatus.READY,
    ...(role === Role.CLIENT
      ? { published: true }
      : { OR: [{ published: true }, { published: false, uploaderId: userId }] }),
  };
}

/** Médias lisibles : montrables ET rattachés à une version d'un projet accessible. */
function mediaScope(
  project: Prisma.ProjectWhereInput,
  userId: number,
  role: Role,
): Prisma.MediaObjectWhereInput {
  return { ...mediaVisibility(userId, role), version: versionScope(project) };
}

/** Sélection commune « d'où vient cette version » : code du plan, nom de l'asset, tâche. */
const parentSelect = {
  task: {
    select: { name: true, shot: { select: { code: true } }, asset: { select: { name: true } } },
  },
  asset: { select: { name: true } },
} as const;

interface ParentRow {
  task: { name: string; shot: { code: string } | null; asset: { name: string } | null } | null;
  asset: { name: string } | null;
}

/** Chemin lisible d'une version : « SH0120 · comp » ou « robot · lookdev ». */
function contextOf(row: ParentRow): string {
  const holder = row.task?.shot?.code ?? row.task?.asset?.name ?? row.asset?.name ?? null;
  return [holder, row.task?.name].filter(Boolean).join(' · ');
}

/** Identifiants des projets dont le demandeur est membre (requête plein texte brute). */
async function memberProjectIds(userId: number): Promise<number[]> {
  const rows = await prisma.projectMembership.findMany({
    where: { userId, project: { deletedAt: null } },
    select: { projectId: true },
  });
  return rows.map((r) => r.projectId);
}

export async function searchEntities(q: string, userId: number, role: Role): Promise<SearchResults> {
  const project = projectScope(userId, role);
  const version = versionScope(project);
  const media = mediaScope(project, userId, role);
  const contains = { contains: q, mode: 'insensitive' as const };

  const [projects, sequences, shots, assets, tasks] = await Promise.all([
    prisma.project.findMany({
      where: { ...project, name: contains },
      select: { id: true, name: true },
      orderBy: { updatedAt: 'desc' },
      take: SEARCH_LIMITS.projects,
    }),
    prisma.sequence.findMany({
      where: { deletedAt: null, project, OR: [{ name: contains }, { code: contains }] },
      select: { id: true, code: true, name: true, projectId: true },
      orderBy: { id: 'desc' },
      take: SEARCH_LIMITS.sequences,
    }),
    prisma.shot.findMany({
      where: { deletedAt: null, project, OR: [{ name: contains }, { code: contains }] },
      select: { id: true, code: true, name: true, projectId: true },
      orderBy: { id: 'desc' },
      take: SEARCH_LIMITS.shots,
    }),
    prisma.asset.findMany({
      where: { deletedAt: null, project, name: contains },
      select: { id: true, name: true, type: true, projectId: true },
      orderBy: { id: 'desc' },
      take: SEARCH_LIMITS.assets,
    }),
    prisma.task.findMany({
      where: {
        name: contains,
        OR: [{ shot: { deletedAt: null, project } }, { asset: { deletedAt: null, project } }],
      },
      select: { id: true, name: true, type: true, shotId: true, assetId: true },
      orderBy: { updatedAt: 'desc' },
      take: SEARCH_LIMITS.tasks,
    }),
  ]);

  // Les identifiants de projets ne servent qu'à la requête plein texte (SQL brut) : la
  // chaîne est montée d'avance pour que les dix recherches partent en parallèle.
  const commentsPromise = (isGlobalRole(role) ? Promise.resolve(null) : memberProjectIds(userId)).then(
    (projectIds) => searchComments(q, { userId, role, projectIds, limit: SEARCH_LIMITS.comments }),
  );

  const [versions, mediaRows, playlists, comments, people] = await Promise.all([
    prisma.version.findMany({
      where: { AND: [version, { name: contains }] },
      select: {
        id: true,
        name: true,
        taskId: true,
        assetId: true,
        ...parentSelect,
        // Le projet est déjà filtré par `version` : inutile de le revérifier sur le média.
        media: {
          where: mediaVisibility(userId, role),
          select: { id: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { createdAt: 'desc' },
      take: SEARCH_LIMITS.versions,
    }),
    prisma.mediaObject.findMany({
      where: { AND: [media, { originalName: contains }] },
      select: {
        id: true,
        originalName: true,
        kind: true,
        version: { select: { name: true, ...parentSelect } },
      },
      orderBy: { createdAt: 'desc' },
      take: SEARCH_LIMITS.media,
    }),
    prisma.playlist.findMany({
      where: { project, name: contains },
      select: { id: true, name: true, project: { select: { name: true } } },
      orderBy: { updatedAt: 'desc' },
      take: SEARCH_LIMITS.playlists,
    }),
    commentsPromise,
    searchPeople(userId, role, contains),
  ]);

  return {
    projects,
    sequences,
    shots,
    assets,
    tasks,
    versions: versions.map((v) => ({
      id: v.id,
      name: v.name,
      mediaId: v.media[0]?.id ?? null,
      taskId: v.taskId,
      assetId: v.assetId,
      context: contextOf(v),
    })),
    media: mediaRows.map((m) => ({
      id: m.id,
      name: m.originalName,
      kind: m.kind,
      context: [contextOf(m.version), m.version.name].filter(Boolean).join(' · '),
    })),
    playlists: playlists.map((p) => ({ id: p.id, name: p.name, projectName: p.project.name })),
    comments,
    people,
  };
}

/**
 * Personnes trouvables. Un CLIENT est un intervenant extérieur : il ne voit que les
 * personnes des projets qu'il partage (même règle que `UserService.listPresence`) et ne peut
 * pas chercher par adresse — l'annuaire du studio n'est pas à lui. Les comptes de service et
 * les comptes désactivés ne sont personne à qui parler.
 */
async function searchPeople(
  userId: number,
  role: Role,
  contains: { contains: string; mode: 'insensitive' },
): Promise<SearchResults['people']> {
  const isClient = role === Role.CLIENT;
  const rows = await prisma.user.findMany({
    where: {
      isService: false,
      disabledAt: null,
      ...(isClient
        ? { memberships: { some: { project: { deletedAt: null, memberships: { some: { userId } } } } } }
        : {}),
      OR: [
        { username: contains },
        { name: contains },
        { firstName: contains },
        { lastName: contains },
        ...(isClient ? [] : [{ email: contains }]),
      ],
    },
    select: { id: true, username: true, name: true, firstName: true, lastName: true, jobTitle: true },
    orderBy: { id: 'asc' },
    take: SEARCH_LIMITS.people,
  });
  return rows.map((u) => {
    const full = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
    return {
      id: u.id,
      // Repli volontairement sans email (cf. `searchComments.authorNameOf`) : un nom absent
      // se rattrape à l'écran, une adresse divulguée ne se rattrape pas.
      name: u.username ?? u.name ?? (full || null),
      jobTitle: u.jobTitle,
    };
  });
}
