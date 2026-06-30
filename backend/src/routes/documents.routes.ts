import { Router } from 'express';
import { z } from 'zod';
import { Role, DocScope, DocKind } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { authenticate } from '../middleware/auth';
import { assertProjectAccess } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import { sanitizeHtml } from '../lib/sanitize';
import { storage } from '../services/StorageService';
import { toPublicUser } from '../lib/userView';
import { forbidden, notFound } from '../lib/errors';

const router = Router();
router.use(authenticate);

const authorSelect = { select: { id: true, name: true, email: true, firstName: true, lastName: true, username: true, avatarKey: true } } as const;
const isManager = (role: Role) => role === Role.ADMIN || role === Role.SUPERVISOR;

// GET /api/documents?projectId=&scope=&scopeId= — liste visible
router.get(
  '/',
  validate({
    query: z.object({
      projectId: z.coerce.number().int().optional(),
      scope: z.nativeEnum(DocScope).optional(),
      scopeId: z.coerce.number().int().optional(),
    }),
  }),
  async (req, res) => {
    const projectId = req.query.projectId ? Number(req.query.projectId) : undefined;
    const scope = req.query.scope as DocScope | undefined;
    const scopeId = req.query.scopeId ? Number(req.query.scopeId) : undefined;

    if (projectId) {
      await assertProjectAccess(req, projectId);
      const docs = await prisma.document.findMany({
        where: { projectId, ...(scope ? { scope } : {}), ...(scopeId !== undefined ? { scopeId } : {}) },
        orderBy: { updatedAt: 'desc' },
        include: { createdBy: authorSelect },
      });
      return res.json({ documents: await withAuthors(docs) });
    }
    // Sans projet : documentation globale (visible par tous les authentifiés)
    const docs = await prisma.document.findMany({
      where: { scope: DocScope.GLOBAL },
      orderBy: { updatedAt: 'desc' },
      include: { createdBy: authorSelect },
    });
    res.json({ documents: await withAuthors(docs) });
  },
);

// GET /api/documents/:id — détail (+ URL PDF présignée)
router.get('/:id', validate({ params: z.object({ id: z.coerce.number().int() }) }), async (req, res) => {
  const doc = await prisma.document.findUnique({ where: { id: Number(req.params.id) }, include: { createdBy: authorSelect } });
  if (!doc) throw notFound('Document introuvable');
  if (doc.projectId) await assertProjectAccess(req, doc.projectId);
  const fileUrl = doc.fileKey ? await storage.getPresignedGetUrl(doc.fileKey) : null;
  res.json({ document: { ...doc, createdBy: await toPublicUser(doc.createdBy), fileUrl } });
});

// POST /api/documents — création (non-client)
router.post(
  '/',
  validate({
    body: z.object({
      title: z.string().min(1).max(200),
      kind: z.nativeEnum(DocKind).default(DocKind.RICH),
      content: z.string().max(200_000).optional(),
      fileKey: z.string().max(512).optional(),
      scope: z.nativeEnum(DocScope).default(DocScope.GLOBAL),
      projectId: z.number().int().nullable().optional(),
      scopeId: z.number().int().nullable().optional(),
    }),
  }),
  async (req, res) => {
    if (req.user!.role === Role.CLIENT) throw forbidden('Création réservée à l’équipe');
    const body = req.body as {
      title: string; kind: DocKind; content?: string; fileKey?: string;
      scope: DocScope; projectId?: number | null; scopeId?: number | null;
    };
    if (body.projectId) await assertProjectAccess(req, body.projectId);
    const doc = await prisma.document.create({
      data: {
        title: body.title,
        kind: body.kind,
        content: body.kind === DocKind.RICH ? sanitizeHtml(body.content ?? '') : null,
        fileKey: body.kind === DocKind.PDF ? body.fileKey ?? null : null,
        scope: body.scope,
        projectId: body.projectId ?? null,
        scopeId: body.scopeId ?? null,
        createdById: req.user!.id,
      },
      include: { createdBy: authorSelect },
    });
    res.status(201).json({ document: { ...doc, createdBy: await toPublicUser(doc.createdBy) } });
  },
);

// PATCH /api/documents/:id — édition (auteur ou superviseur/admin)
router.patch(
  '/:id',
  validate({
    params: z.object({ id: z.coerce.number().int() }),
    body: z.object({
      title: z.string().min(1).max(200).optional(),
      content: z.string().max(200_000).optional(),
      scope: z.nativeEnum(DocScope).optional(),
      projectId: z.number().int().nullable().optional(),
      scopeId: z.number().int().nullable().optional(),
    }),
  }),
  async (req, res) => {
    const id = Number(req.params.id);
    const existing = await prisma.document.findUnique({ where: { id } });
    if (!existing) throw notFound('Document introuvable');
    if (existing.createdById !== req.user!.id && !isManager(req.user!.role)) throw forbidden('Édition non autorisée');
    if (existing.projectId) await assertProjectAccess(req, existing.projectId);
    const body = req.body as { title?: string; content?: string; scope?: DocScope; projectId?: number | null; scopeId?: number | null };
    const doc = await prisma.document.update({
      where: { id },
      data: {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.content !== undefined ? { content: sanitizeHtml(body.content) } : {}),
        ...(body.scope !== undefined ? { scope: body.scope } : {}),
        ...(body.projectId !== undefined ? { projectId: body.projectId } : {}),
        ...(body.scopeId !== undefined ? { scopeId: body.scopeId } : {}),
      },
      include: { createdBy: authorSelect },
    });
    res.json({ document: { ...doc, createdBy: await toPublicUser(doc.createdBy) } });
  },
);

// DELETE /api/documents/:id — auteur ou superviseur/admin
router.delete('/:id', validate({ params: z.object({ id: z.coerce.number().int() }) }), async (req, res) => {
  const id = Number(req.params.id);
  const existing = await prisma.document.findUnique({ where: { id } });
  if (!existing) throw notFound('Document introuvable');
  if (existing.createdById !== req.user!.id && !isManager(req.user!.role)) throw forbidden('Suppression non autorisée');
  if (existing.fileKey) await storage.deleteObject(existing.fileKey).catch(() => undefined);
  await prisma.document.delete({ where: { id } });
  res.status(204).end();
});

// POST /api/documents/pdf/presign — URL présignée pour l'upload d'un PDF
router.post(
  '/pdf/presign',
  validate({ body: z.object({ filename: z.string().min(1).max(200) }) }),
  async (req, res) => {
    if (req.user!.role === Role.CLIENT) throw forbidden('Réservé à l’équipe');
    const { filename } = req.body as { filename: string };
    const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const key = `documents/${Date.now()}-${safe}`;
    const url = await storage.getPresignedPutUrl(key, 'application/pdf', 900);
    res.json({ url, key });
  },
);

// Helper : remplace les auteurs bruts par des vues publiques (avatar/displayName).
async function withAuthors<T extends { createdBy: Parameters<typeof toPublicUser>[0] }>(docs: T[]) {
  return Promise.all(docs.map(async (d) => ({ ...d, createdBy: await toPublicUser(d.createdBy) })));
}

export default router;
