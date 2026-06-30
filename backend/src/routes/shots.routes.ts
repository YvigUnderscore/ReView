import { Router } from 'express';
import { z } from 'zod';
import { Role, AssetType } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { authenticate } from '../middleware/auth';
import { requireRole, assertProjectAccess } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import { resolveProjectIdForShot } from '../lib/pipeline';
import { softDeleteShot, restoreShot, purgeShot } from '../lib/trash';
import { firstMediaThumbKeyForShot, effectiveThumbnailUrl } from '../lib/thumbnails';
import { logAudit } from '../services/AuditService';
import { badRequest, notFound } from '../lib/errors';

const router = Router();
router.use(authenticate);

// GET /api/shots?projectId=X[&sequenceId=Y]
router.get(
  '/',
  validate({
    query: z.object({
      projectId: z.coerce.number().int(),
      sequenceId: z.coerce.number().int().optional(),
    }),
  }),
  async (req, res) => {
    const projectId = Number(req.query.projectId);
    await assertProjectAccess(req, projectId);
    const sequenceId = req.query.sequenceId ? Number(req.query.sequenceId) : undefined;
    const shots = await prisma.shot.findMany({
      where: { projectId, deletedAt: null, ...(sequenceId ? { sequenceId } : {}) },
      orderBy: { order: 'asc' },
      include: {
        _count: { select: { tasks: true } },
        assets: { where: { deletedAt: null }, select: { id: true, name: true, type: true } },
      },
    });
    const withThumbs = await Promise.all(
      shots.map(async (s) => ({
        ...s,
        thumbnailUrl: await effectiveThumbnailUrl(s.thumbnailKey, await firstMediaThumbKeyForShot(s.id)),
      })),
    );
    res.json({ shots: withThumbs });
  },
);

// POST /api/shots (admin/superviseur)
router.post(
  '/',
  requireRole(Role.ADMIN, Role.SUPERVISOR),
  validate({
    body: z.object({
      projectId: z.number().int(),
      sequenceId: z.number().int().nullable().optional(),
      name: z.string().min(1).max(160),
      code: z.string().min(1).max(60),
      startFrame: z.number().int().nullable().optional(),
      endFrame: z.number().int().nullable().optional(),
      order: z.number().int().optional(),
    }),
  }),
  async (req, res) => {
    const body = req.body as {
      projectId: number; sequenceId?: number | null; name: string; code: string;
      startFrame?: number | null; endFrame?: number | null; order?: number;
    };
    await assertProjectAccess(req, body.projectId);
    // La séquence (si fournie) doit appartenir au même projet
    if (body.sequenceId) {
      const seq = await prisma.sequence.findUnique({ where: { id: body.sequenceId }, select: { projectId: true } });
      if (!seq || seq.projectId !== body.projectId) throw badRequest('Séquence invalide pour ce projet', 'BAD_SEQUENCE');
    }
    // Unicité du code par séquence (les shots sans séquence sont un groupe à part)
    if (
      await prisma.shot.findFirst({
        where: {
          projectId: body.projectId,
          sequenceId: body.sequenceId ?? null,
          code: body.code,
          deletedAt: null,
        },
        select: { id: true },
      })
    ) {
      throw badRequest('Un shot avec ce code existe déjà dans cette séquence', 'CODE_TAKEN');
    }
    const shot = await prisma.shot.create({
      data: {
        projectId: body.projectId,
        sequenceId: body.sequenceId ?? null,
        name: body.name,
        code: body.code,
        startFrame: body.startFrame ?? null,
        endFrame: body.endFrame ?? null,
        order: body.order ?? 0,
      },
    });
    res.status(201).json({ shot });
  },
);

// POST /api/shots/bulk — création en lot (admin/superviseur)
router.post(
  '/bulk',
  requireRole(Role.ADMIN, Role.SUPERVISOR),
  validate({
    body: z.object({
      projectId: z.number().int(),
      items: z
        .array(
          z.object({
            sequenceId: z.number().int().nullable().optional(),
            name: z.string().min(1).max(160),
            code: z.string().min(1).max(60),
            startFrame: z.number().int().nullable().optional(),
            endFrame: z.number().int().nullable().optional(),
            order: z.number().int().optional(),
          }),
        )
        .min(1)
        .max(200),
    }),
  }),
  async (req, res) => {
    const { projectId, items } = req.body as {
      projectId: number;
      items: { sequenceId?: number | null; name: string; code: string; startFrame?: number | null; endFrame?: number | null; order?: number }[];
    };
    await assertProjectAccess(req, projectId);
    // Les séquences référencées doivent appartenir au projet
    const seqIds = [...new Set(items.map((i) => i.sequenceId).filter((v): v is number => !!v))];
    if (seqIds.length > 0) {
      const ok = await prisma.sequence.count({ where: { id: { in: seqIds }, projectId } });
      if (ok !== seqIds.length) throw badRequest('Séquence invalide pour ce projet', 'BAD_SEQUENCE');
    }
    // Doublons (code, séquence) dans le lot
    const key = (sid: number | null | undefined, code: string) => `${sid ?? 'none'}::${code}`;
    const keys = items.map((i) => key(i.sequenceId, i.code));
    const dup = keys.find((k, i) => keys.indexOf(k) !== i);
    if (dup) throw badRequest(`Code en double dans le lot : ${dup.split('::')[1]}`, 'CODE_DUP');
    // Conflits avec l'existant
    const existing = await prisma.shot.findMany({
      where: { projectId, deletedAt: null, code: { in: items.map((i) => i.code) } },
      select: { code: true, sequenceId: true },
    });
    const existingKeys = new Set(existing.map((e) => key(e.sequenceId, e.code)));
    const clash = items.find((i) => existingKeys.has(key(i.sequenceId, i.code)));
    if (clash) throw badRequest(`Shot déjà existant dans cette séquence : ${clash.code}`, 'CODE_TAKEN');
    const created = await prisma.$transaction(
      items.map((it, idx) =>
        prisma.shot.create({
          data: {
            projectId,
            sequenceId: it.sequenceId ?? null,
            name: it.name,
            code: it.code,
            startFrame: it.startFrame ?? null,
            endFrame: it.endFrame ?? null,
            order: it.order ?? idx,
          },
        }),
      ),
    );
    res.status(201).json({ shots: created });
  },
);

// GET /api/shots/:id
router.get('/:id', validate({ params: z.object({ id: z.coerce.number().int() }) }), async (req, res) => {
  const id = Number(req.params.id);
  const shot = await prisma.shot.findUnique({
    where: { id },
    include: {
      sequence: true,
      tasks: { orderBy: { order: 'asc' }, include: { assignee: { select: { id: true, name: true } } } },
      assets: { where: { deletedAt: null }, select: { id: true, name: true, type: true } },
    },
  });
  if (!shot) throw notFound('Shot introuvable');
  await assertProjectAccess(req, shot.projectId);
  res.json({ shot });
});

// PATCH /api/shots/:id (admin/superviseur)
router.patch(
  '/:id',
  requireRole(Role.ADMIN, Role.SUPERVISOR),
  validate({
    params: z.object({ id: z.coerce.number().int() }),
    body: z.object({
      sequenceId: z.number().int().nullable().optional(),
      name: z.string().min(1).max(160).optional(),
      code: z.string().min(1).max(60).optional(),
      startFrame: z.number().int().nullable().optional(),
      endFrame: z.number().int().nullable().optional(),
      order: z.number().int().optional(),
      thumbnailKey: z.string().max(512).nullable().optional(),
    }),
  }),
  async (req, res) => {
    const id = Number(req.params.id);
    const projectId = await resolveProjectIdForShot(id);
    if (!projectId) throw notFound('Shot introuvable');
    await assertProjectAccess(req, projectId);
    const body = req.body as { sequenceId?: number | null; code?: string };
    if (body.sequenceId) {
      const seq = await prisma.sequence.findUnique({ where: { id: body.sequenceId }, select: { projectId: true } });
      if (!seq || seq.projectId !== projectId) throw badRequest('Séquence invalide pour ce projet', 'BAD_SEQUENCE');
    }
    // Si le code ou la séquence change, vérifier l'unicité (code unique par séquence)
    if (body.code !== undefined || body.sequenceId !== undefined) {
      const current = await prisma.shot.findUnique({ where: { id }, select: { code: true, sequenceId: true } });
      const nextCode = body.code ?? current!.code;
      const nextSequenceId = body.sequenceId !== undefined ? body.sequenceId : current!.sequenceId;
      const conflict = await prisma.shot.findFirst({
        where: { projectId, sequenceId: nextSequenceId, code: nextCode, deletedAt: null, id: { not: id } },
        select: { id: true },
      });
      if (conflict) throw badRequest('Un shot avec ce code existe déjà dans cette séquence', 'CODE_TAKEN');
    }
    const shot = await prisma.shot.update({ where: { id }, data: req.body });
    res.json({ shot });
  },
);

// POST /api/shots/:id/assets — rattache un asset existant OU en crée un et le rattache.
router.post(
  '/:id/assets',
  requireRole(Role.ADMIN, Role.SUPERVISOR),
  validate({
    params: z.object({ id: z.coerce.number().int() }),
    body: z.object({
      assetId: z.number().int().optional(),
      name: z.string().min(1).max(160).optional(),
      type: z.nativeEnum(AssetType).optional(),
    }).refine((b) => b.assetId !== undefined || (b.name && b.name.trim().length > 0), 'assetId ou name requis'),
  }),
  async (req, res) => {
    const shotId = Number(req.params.id);
    const projectId = await resolveProjectIdForShot(shotId);
    if (!projectId) throw notFound('Shot introuvable');
    await assertProjectAccess(req, projectId);
    const body = req.body as { assetId?: number; name?: string; type?: AssetType };

    let assetId = body.assetId;
    if (assetId === undefined) {
      // Création d'un nouvel asset dans le projet
      if (await prisma.asset.findUnique({ where: { projectId_name: { projectId, name: body.name! } } })) {
        throw badRequest('Un asset avec ce nom existe déjà', 'NAME_TAKEN');
      }
      const created = await prisma.asset.create({ data: { projectId, name: body.name!, type: body.type ?? AssetType.OTHER } });
      assetId = created.id;
    } else {
      const asset = await prisma.asset.findUnique({ where: { id: assetId }, select: { projectId: true } });
      if (!asset || asset.projectId !== projectId) throw badRequest('Asset invalide pour ce projet', 'BAD_ASSET');
    }
    await prisma.shot.update({ where: { id: shotId }, data: { assets: { connect: { id: assetId } } } });
    const asset = await prisma.asset.findUnique({ where: { id: assetId }, select: { id: true, name: true, type: true } });
    res.status(201).json({ asset });
  },
);

// DELETE /api/shots/:id/assets/:assetId — détache un asset d'un shot (sans le supprimer)
router.delete(
  '/:id/assets/:assetId',
  requireRole(Role.ADMIN, Role.SUPERVISOR),
  validate({ params: z.object({ id: z.coerce.number().int(), assetId: z.coerce.number().int() }) }),
  async (req, res) => {
    const shotId = Number(req.params.id);
    const projectId = await resolveProjectIdForShot(shotId);
    if (!projectId) throw notFound('Shot introuvable');
    await assertProjectAccess(req, projectId);
    await prisma.shot.update({ where: { id: shotId }, data: { assets: { disconnect: { id: Number(req.params.assetId) } } } });
    res.status(204).end();
  },
);

// DELETE /api/shots/:id — corbeille (soft-delete, admin/superviseur)
router.delete(
  '/:id',
  requireRole(Role.ADMIN, Role.SUPERVISOR),
  validate({ params: z.object({ id: z.coerce.number().int() }) }),
  async (req, res) => {
    const id = Number(req.params.id);
    const projectId = await resolveProjectIdForShot(id);
    if (!projectId) throw notFound('Shot introuvable');
    await assertProjectAccess(req, projectId);
    await softDeleteShot(id);
    logAudit({ userId: req.user!.id, action: 'SHOT_DELETE', entityType: 'Shot', entityId: id });
    res.status(204).end();
  },
);

// POST /api/shots/:id/restore (admin/superviseur)
router.post(
  '/:id/restore',
  requireRole(Role.ADMIN, Role.SUPERVISOR),
  validate({ params: z.object({ id: z.coerce.number().int() }) }),
  async (req, res) => {
    const id = Number(req.params.id);
    const projectId = await resolveProjectIdForShot(id);
    if (!projectId) throw notFound('Shot introuvable');
    await assertProjectAccess(req, projectId);
    await restoreShot(id);
    res.status(204).end();
  },
);

// DELETE /api/shots/:id/purge — suppression définitive (admin/superviseur)
router.delete(
  '/:id/purge',
  requireRole(Role.ADMIN, Role.SUPERVISOR),
  validate({ params: z.object({ id: z.coerce.number().int() }) }),
  async (req, res) => {
    const id = Number(req.params.id);
    const projectId = await resolveProjectIdForShot(id);
    if (!projectId) throw notFound('Shot introuvable');
    await assertProjectAccess(req, projectId);
    await purgeShot(id);
    logAudit({ userId: req.user!.id, action: 'SHOT_PURGE', entityType: 'Shot', entityId: id });
    res.status(204).end();
  },
);

export default router;
