import { Router } from 'express';
import { z } from 'zod';
import { Role, ProjectStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { authenticate } from '../middleware/auth';
import { requireRole, requireProjectAccess } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import { logAudit } from '../services/AuditService';
import { softDeleteProject, restoreProject, purgeProject } from '../lib/trash';
import { firstMediaThumbKeyForProject, effectiveThumbnailUrl } from '../lib/thumbnails';
import { getNumericSetting, SETTING_KEYS } from '../lib/settings';
import { resolveProjectSettings } from '../lib/projectSettings';
import { notFound, badRequest } from '../lib/errors';

const router = Router();
router.use(authenticate);

const slugify = (s: string) =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const isGlobal = (role: Role) => role === Role.ADMIN || role === Role.SUPERVISOR;

// GET /api/projects — admin/superviseur : tout ; sinon : projets dont l'user est membre
router.get('/', async (req, res) => {
  const { id, role } = req.user!;
  const where = isGlobal(role)
    ? { deletedAt: null }
    : { deletedAt: null, memberships: { some: { userId: id } } };
  const projects = await prisma.project.findMany({ where, orderBy: { updatedAt: 'desc' } });
  const withThumbs = await Promise.all(
    projects.map(async (p) => ({
      ...p,
      thumbnailUrl: await effectiveThumbnailUrl(p.thumbnailKey, await firstMediaThumbKeyForProject(p.id)),
    })),
  );
  res.json({ projects: withThumbs });
});

// POST /api/projects (admin/superviseur)
router.post(
  '/',
  requireRole(Role.ADMIN, Role.SUPERVISOR),
  validate({
    body: z.object({
      name: z.string().min(1).max(160),
      description: z.string().max(2000).optional(),
      startFrame: z.number().int().optional(),
    }),
  }),
  async (req, res) => {
    const { name, description, startFrame } = req.body as {
      name: string;
      description?: string;
      startFrame?: number;
    };
    const studio = await prisma.studio.findFirst();
    if (!studio) throw notFound('Studio non configuré');

    const slug = slugify(name);
    if (!slug) throw badRequest('Nom de projet invalide');
    if (await prisma.project.findUnique({ where: { studioId_slug: { studioId: studio.id, slug } } })) {
      throw badRequest('Un projet avec ce nom existe déjà', 'SLUG_TAKEN');
    }

    // Frame de départ : valeur fournie, sinon défaut studio configurable
    const defaultStartFrame = await getNumericSetting(SETTING_KEYS.DEFAULT_START_FRAME);

    const project = await prisma.project.create({
      data: {
        studioId: studio.id,
        name,
        slug,
        description: description ?? null,
        startFrame: startFrame ?? defaultStartFrame,
        memberships: { create: { userId: req.user!.id } },
      },
    });
    logAudit({
      userId: req.user!.id,
      action: 'PROJECT_CREATE',
      entityType: 'Project',
      entityId: project.id,
      metadata: { name },
    });
    res.status(201).json({ project });
  },
);

// GET /api/projects/:projectId
router.get(
  '/:projectId',
  validate({ params: z.object({ projectId: z.coerce.number().int() }) }),
  requireProjectAccess,
  async (req, res) => {
    const project = await prisma.project.findFirst({
      where: { id: Number(req.params.projectId), deletedAt: null },
      include: {
        memberships: { include: { user: { select: { id: true, name: true, email: true, role: true } } } },
      },
    });
    if (!project) throw notFound('Projet introuvable');
    res.json({ project });
  },
);

// PATCH /api/projects/:projectId (admin/superviseur)
router.patch(
  '/:projectId',
  validate({
    params: z.object({ projectId: z.coerce.number().int() }),
    body: z.object({
      name: z.string().min(1).max(160).optional(),
      description: z.string().max(2000).nullable().optional(),
      status: z.nativeEnum(ProjectStatus).optional(),
      thumbnailKey: z.string().max(512).nullable().optional(),
      startFrame: z.number().int().optional(),
    }),
  }),
  requireRole(Role.ADMIN, Role.SUPERVISOR),
  async (req, res) => {
    const id = Number(req.params.projectId);
    if (!(await prisma.project.findFirst({ where: { id, deletedAt: null } })))
      throw notFound('Projet introuvable');
    const project = await prisma.project.update({ where: { id }, data: req.body });
    res.json({ project });
  },
);

// DELETE /api/projects/:projectId — soft delete (admin/superviseur)
router.delete(
  '/:projectId',
  validate({ params: z.object({ projectId: z.coerce.number().int() }) }),
  requireRole(Role.ADMIN, Role.SUPERVISOR),
  async (req, res) => {
    const id = Number(req.params.projectId);
    await softDeleteProject(id);
    logAudit({ userId: req.user!.id, action: 'PROJECT_DELETE', entityType: 'Project', entityId: id });
    res.status(204).end();
  },
);

// GET /api/projects/:projectId/trash — éléments supprimés du projet (admin/superviseur)
router.get(
  '/:projectId/trash',
  validate({ params: z.object({ projectId: z.coerce.number().int() }) }),
  requireRole(Role.ADMIN, Role.SUPERVISOR),
  async (req, res) => {
    const projectId = Number(req.params.projectId);
    const mediaWhere = {
      deletedAt: { not: null },
      version: {
        OR: [{ task: { shot: { projectId } } }, { task: { asset: { projectId } } }, { asset: { projectId } }],
      },
    };
    const [sequences, shots, assets, versions, media] = await Promise.all([
      prisma.sequence.findMany({
        where: { projectId, deletedAt: { not: null } },
        orderBy: { deletedAt: 'desc' },
      }),
      prisma.shot.findMany({
        where: { projectId, deletedAt: { not: null } },
        orderBy: { deletedAt: 'desc' },
      }),
      prisma.asset.findMany({
        where: { projectId, deletedAt: { not: null } },
        orderBy: { deletedAt: 'desc' },
      }),
      prisma.version.findMany({
        where: {
          deletedAt: { not: null },
          OR: [
            { task: { shot: { projectId } } },
            { task: { asset: { projectId } } },
            { asset: { projectId } },
          ],
        },
        orderBy: { deletedAt: 'desc' },
      }),
      prisma.mediaObject.findMany({ where: mediaWhere, orderBy: { deletedAt: 'desc' } }),
    ]);
    res.json({
      sequences,
      shots,
      assets,
      versions,
      media: media.map((m) => ({ ...m, size: Number(m.size) })),
    });
  },
);

// POST /api/projects/:projectId/restore (admin/superviseur)
router.post(
  '/:projectId/restore',
  validate({ params: z.object({ projectId: z.coerce.number().int() }) }),
  requireRole(Role.ADMIN, Role.SUPERVISOR),
  async (req, res) => {
    const id = Number(req.params.projectId);
    await restoreProject(id);
    logAudit({ userId: req.user!.id, action: 'PROJECT_RESTORE', entityType: 'Project', entityId: id });
    res.status(204).end();
  },
);

// DELETE /api/projects/:projectId/purge — suppression définitive DB + MinIO (admin)
router.delete(
  '/:projectId/purge',
  validate({ params: z.object({ projectId: z.coerce.number().int() }) }),
  requireRole(Role.ADMIN),
  async (req, res) => {
    const id = Number(req.params.projectId);
    await purgeProject(id);
    logAudit({ userId: req.user!.id, action: 'PROJECT_PURGE', entityType: 'Project', entityId: id });
    res.status(204).end();
  },
);

// POST /api/projects/:projectId/members (admin/superviseur)
router.post(
  '/:projectId/members',
  validate({
    params: z.object({ projectId: z.coerce.number().int() }),
    body: z.object({ userId: z.number().int(), role: z.nativeEnum(Role).optional() }),
  }),
  requireRole(Role.ADMIN, Role.SUPERVISOR),
  async (req, res) => {
    const projectId = Number(req.params.projectId);
    const { userId, role } = req.body as { userId: number; role?: Role };
    const membership = await prisma.projectMembership.upsert({
      where: { userId_projectId: { userId, projectId } },
      update: { role: role ?? null },
      create: { userId, projectId, role: role ?? null },
    });
    res.status(201).json({ membership });
  },
);

// GET /api/projects/:projectId/settings — réglages effectifs (départements, nomenclature)
router.get(
  '/:projectId/settings',
  validate({ params: z.object({ projectId: z.coerce.number().int() }) }),
  requireProjectAccess,
  async (req, res) => {
    const project = await prisma.project.findFirst({
      where: { id: Number(req.params.projectId), deletedAt: null },
      select: { settings: true },
    });
    if (!project) throw notFound('Projet introuvable');
    const settings = await resolveProjectSettings(project.settings);
    res.json({ settings });
  },
);

// PUT /api/projects/:projectId/settings — override des réglages projet (admin/superviseur)
router.put(
  '/:projectId/settings',
  validate({
    params: z.object({ projectId: z.coerce.number().int() }),
    body: z.object({
      departments: z
        .array(z.object({ key: z.string().min(1).max(40), name: z.string().min(1).max(80) }))
        .optional(),
      nomenclature: z
        .object({
          sequencePrefix: z.string().max(16),
          shotPrefix: z.string().max(16),
          padding: z.number().int().min(1).max(8),
          step: z.number().int().min(1),
        })
        .optional(),
    }),
  }),
  requireRole(Role.ADMIN, Role.SUPERVISOR),
  async (req, res) => {
    const id = Number(req.params.projectId);
    if (!(await prisma.project.findFirst({ where: { id, deletedAt: null } })))
      throw notFound('Projet introuvable');
    await prisma.project.update({ where: { id }, data: { settings: req.body as object } });
    const settings = await resolveProjectSettings(req.body);
    logAudit({
      userId: req.user!.id,
      action: 'PROJECT_SETTINGS_UPDATE',
      entityType: 'Project',
      entityId: id,
    });
    res.json({ settings });
  },
);

// GET /api/projects/:projectId/activity — flux d'activité (derniers uploads, versions) + tâches
router.get(
  '/:projectId/activity',
  validate({ params: z.object({ projectId: z.coerce.number().int() }) }),
  requireProjectAccess,
  async (req, res) => {
    const projectId = Number(req.params.projectId);
    const inProject = {
      OR: [{ task: { shot: { projectId } } }, { task: { asset: { projectId } } }, { asset: { projectId } }],
    };

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

    // Localisation lisible pour une task (shot/séquence ou asset)
    const loc = (
      t: {
        shot?: { code: string; sequence?: { code: string } | null } | null;
        asset?: { name: string } | null;
      } | null,
    ) => {
      if (!t) return '';
      if (t.shot) return `${t.shot.sequence ? t.shot.sequence.code + ' · ' : ''}${t.shot.code}`;
      if (t.asset) return t.asset.name;
      return '';
    };

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

    res.json({
      recent,
      tasks: tasks.map((t) => ({
        id: t.id,
        name: t.name,
        type: t.type,
        status: t.status,
        assignee: t.assignee ? { id: t.assignee.id, name: t.assignee.name } : null,
        location: loc(t),
      })),
    });
  },
);

// DELETE /api/projects/:projectId/members/:userId (admin/superviseur)
router.delete(
  '/:projectId/members/:userId',
  validate({ params: z.object({ projectId: z.coerce.number().int(), userId: z.coerce.number().int() }) }),
  requireRole(Role.ADMIN, Role.SUPERVISOR),
  async (req, res) => {
    await prisma.projectMembership.delete({
      where: {
        userId_projectId: { userId: Number(req.params.userId), projectId: Number(req.params.projectId) },
      },
    });
    res.status(204).end();
  },
);

export default router;
