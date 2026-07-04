import { Role, ProjectStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { logAudit } from './AuditService';
import { softDeleteProject, restoreProject, purgeProject } from '../lib/trash';
import { firstMediaThumbKeyForProject, effectiveThumbnailUrl } from '../lib/thumbnails';
import { getNumericSetting, SETTING_KEYS } from '../lib/settings';
import { resolveProjectSettings } from '../lib/projectSettings';
import { slugify } from '../lib/slug';
import { notFound, badRequest } from '../lib/errors';
import { type PaginationParams, type Paginated, pageArgs, paginate, orderByFrom } from '../lib/pagination';

/**
 * Logique métier des projets (liste avec miniatures, CRUD, membres, réglages,
 * corbeille, activité). Les routes ne font que valider → appeler → répondre (10.D8).
 */

type SessionUser = { id: number; role: Role };

const isGlobal = (role: Role) => role === Role.ADMIN || role === Role.SUPERVISOR;

/** Sélecteur `OR` des entités (versions/médias) rattachées à un projet donné. */
const versionInProject = (projectId: number) => ({
  OR: [{ task: { shot: { projectId } } }, { task: { asset: { projectId } } }, { asset: { projectId } }],
});

/** Liste paginée des projets visibles (globale pour admin/superviseur, membership sinon) + miniatures. */
export async function listProjects(user: SessionUser, p: PaginationParams): Promise<Paginated<unknown>> {
  const where = isGlobal(user.role)
    ? { deletedAt: null }
    : { deletedAt: null, memberships: { some: { userId: user.id } } };
  const orderBy = orderByFrom(p, ['updatedAt', 'createdAt', 'name'], { updatedAt: 'desc' });
  const [projects, total] = await Promise.all([
    prisma.project.findMany({ where, orderBy, ...pageArgs(p) }),
    prisma.project.count({ where }),
  ]);
  const items = await Promise.all(
    projects.map(async (proj) => ({
      ...proj,
      thumbnailUrl: await effectiveThumbnailUrl(
        proj.thumbnailKey,
        await firstMediaThumbKeyForProject(proj.id),
      ),
    })),
  );
  return paginate(items, total, p);
}

export interface CreateProjectInput {
  name: string;
  description?: string;
  startFrame?: number;
}

export async function createProject(user: SessionUser, input: CreateProjectInput) {
  const studio = await prisma.studio.findFirst();
  if (!studio) throw notFound('Studio non configuré');

  const slug = slugify(input.name);
  if (!slug) throw badRequest('Nom de projet invalide');
  if (await prisma.project.findUnique({ where: { studioId_slug: { studioId: studio.id, slug } } }))
    throw badRequest('Un projet avec ce nom existe déjà', 'SLUG_TAKEN');

  const defaultStartFrame = await getNumericSetting(SETTING_KEYS.DEFAULT_START_FRAME);
  const project = await prisma.project.create({
    data: {
      studioId: studio.id,
      name: input.name,
      slug,
      description: input.description ?? null,
      startFrame: input.startFrame ?? defaultStartFrame,
      memberships: { create: { userId: user.id } },
    },
  });
  logAudit({
    userId: user.id,
    action: 'PROJECT_CREATE',
    entityType: 'Project',
    entityId: project.id,
    metadata: { name: input.name },
  });
  return project;
}

export async function getProject(projectId: number) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, deletedAt: null },
    include: {
      memberships: { include: { user: { select: { id: true, name: true, email: true, role: true } } } },
    },
  });
  if (!project) throw notFound('Projet introuvable');
  return project;
}

export interface UpdateProjectInput {
  name?: string;
  description?: string | null;
  status?: ProjectStatus;
  thumbnailKey?: string | null;
  startFrame?: number;
}

export async function updateProject(projectId: number, data: UpdateProjectInput) {
  if (!(await prisma.project.findFirst({ where: { id: projectId, deletedAt: null } })))
    throw notFound('Projet introuvable');
  return prisma.project.update({ where: { id: projectId }, data });
}

export async function softDelete(user: SessionUser, projectId: number) {
  await softDeleteProject(projectId);
  logAudit({ userId: user.id, action: 'PROJECT_DELETE', entityType: 'Project', entityId: projectId });
}

export async function restore(user: SessionUser, projectId: number) {
  await restoreProject(projectId);
  logAudit({ userId: user.id, action: 'PROJECT_RESTORE', entityType: 'Project', entityId: projectId });
}

export async function purge(user: SessionUser, projectId: number) {
  await purgeProject(projectId);
  logAudit({ userId: user.id, action: 'PROJECT_PURGE', entityType: 'Project', entityId: projectId });
}

export async function addMember(projectId: number, userId: number, role?: Role) {
  return prisma.projectMembership.upsert({
    where: { userId_projectId: { userId, projectId } },
    update: { role: role ?? null },
    create: { userId, projectId, role: role ?? null },
  });
}

export async function removeMember(projectId: number, userId: number) {
  await prisma.projectMembership.delete({ where: { userId_projectId: { userId, projectId } } });
}

export async function getSettings(projectId: number) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, deletedAt: null },
    select: { settings: true },
  });
  if (!project) throw notFound('Projet introuvable');
  return resolveProjectSettings(project.settings);
}

export async function updateSettings(user: SessionUser, projectId: number, body: object) {
  if (!(await prisma.project.findFirst({ where: { id: projectId, deletedAt: null } })))
    throw notFound('Projet introuvable');
  await prisma.project.update({ where: { id: projectId }, data: { settings: body } });
  logAudit({
    userId: user.id,
    action: 'PROJECT_SETTINGS_UPDATE',
    entityType: 'Project',
    entityId: projectId,
  });
  return resolveProjectSettings(body);
}

/** Éléments en corbeille d'un projet (séquences, shots, assets, versions, médias). */
export async function getTrash(projectId: number) {
  const mediaWhere = { deletedAt: { not: null }, version: versionInProject(projectId) };
  const [sequences, shots, assets, versions, media] = await Promise.all([
    prisma.sequence.findMany({
      where: { projectId, deletedAt: { not: null } },
      orderBy: { deletedAt: 'desc' },
    }),
    prisma.shot.findMany({ where: { projectId, deletedAt: { not: null } }, orderBy: { deletedAt: 'desc' } }),
    prisma.asset.findMany({ where: { projectId, deletedAt: { not: null } }, orderBy: { deletedAt: 'desc' } }),
    prisma.version.findMany({
      where: { deletedAt: { not: null }, ...versionInProject(projectId) },
      orderBy: { deletedAt: 'desc' },
    }),
    prisma.mediaObject.findMany({ where: mediaWhere, orderBy: { deletedAt: 'desc' } }),
  ]);
  return { sequences, shots, assets, versions, media: media.map((m) => ({ ...m, size: Number(m.size) })) };
}

/** Localisation lisible d'une tâche/version (shot·séquence ou asset). */
function loc(
  t: {
    shot?: { code: string; sequence?: { code: string } | null } | null;
    asset?: { name: string } | null;
  } | null,
): string {
  if (!t) return '';
  if (t.shot) return `${t.shot.sequence ? t.shot.sequence.code + ' · ' : ''}${t.shot.code}`;
  if (t.asset) return t.asset.name;
  return '';
}

/** Flux d'activité (dernières versions + médias publiés) + tâches du projet. */
export async function getActivity(projectId: number) {
  const inProject = versionInProject(projectId);
  const [versions, media, tasks] = await Promise.all([
    prisma.version.findMany({
      where: { deletedAt: null, ...inProject },
      orderBy: { createdAt: 'desc' },
      take: 15,
      include: {
        author: { select: { id: true, name: true } },
        task: {
          select: {
            id: true,
            name: true,
            shot: { select: { code: true, sequence: { select: { code: true } } } },
            asset: { select: { name: true } },
          },
        },
        asset: { select: { name: true } },
      },
    }),
    prisma.mediaObject.findMany({
      where: { deletedAt: null, published: true, version: inProject },
      orderBy: { createdAt: 'desc' },
      take: 15,
      include: {
        uploader: { select: { id: true, name: true } },
        version: {
          select: {
            name: true,
            task: {
              select: {
                id: true,
                name: true,
                shot: { select: { code: true, sequence: { select: { code: true } } } },
                asset: { select: { name: true } },
              },
            },
            asset: { select: { name: true } },
          },
        },
      },
    }),
    prisma.task.findMany({
      where: { OR: [{ shot: { projectId } }, { asset: { projectId } }] },
      orderBy: { updatedAt: 'desc' },
      take: 100,
      include: {
        assignee: { select: { id: true, name: true } },
        shot: { select: { id: true, code: true, sequence: { select: { code: true } } } },
        asset: { select: { id: true, name: true } },
      },
    }),
  ]);

  const recent = [
    ...versions.map((v) => ({
      type: 'version' as const,
      id: v.id,
      at: v.createdAt,
      label: `${v.name}${v.task ? ' — ' + v.task.name : ''}`,
      location: loc(v.task),
      versionId: v.id,
      taskId: v.task?.id ?? null,
      author: v.author?.name ?? null,
    })),
    ...media.map((m) => ({
      type: 'media' as const,
      id: m.id,
      at: m.createdAt,
      label: m.originalName,
      kind: m.kind,
      location: loc(m.version?.task ?? null) || (m.version?.asset?.name ?? ''),
      mediaId: m.id,
      taskId: m.version?.task?.id ?? null,
      author: m.uploader?.name ?? null,
    })),
  ]
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, 20);

  return {
    recent,
    tasks: tasks.map((t) => ({
      id: t.id,
      name: t.name,
      type: t.type,
      status: t.status,
      assignee: t.assignee ? { id: t.assignee.id, name: t.assignee.name } : null,
      location: loc(t),
    })),
  };
}
