// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { Role, DocScope, DocKind } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { authenticate } from '../middleware/auth';
import { assertProjectAccess } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import { sanitizeHtml } from '../lib/sanitize';
import { storage } from '../services/StorageService';
import { toPublicUser, publicUserSelect, withPublicAuthors } from '../lib/userView';
import { forbidden, notFound } from '../lib/errors';
import { isValidDocumentKey, assertDocumentKey, documentUploadKey } from '../lib/documentKeys';

const router = Router();
router.use(authenticate);

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
        include: { createdBy: publicUserSelect },
      });
      return res.json({ documents: await withPublicAuthors(docs) });
    }
    // Sans projet : documentation globale (visible par tous les authentifiés)
    const docs = await prisma.document.findMany({
      where: { scope: DocScope.GLOBAL },
      orderBy: { updatedAt: 'desc' },
      include: { createdBy: publicUserSelect },
    });
    res.json({ documents: await withPublicAuthors(docs) });
  },
);

// GET /api/documents/:id — détail (+ URL PDF présignée)
router.get('/:id', validate({ params: z.object({ id: z.coerce.number().int() }) }), async (req, res) => {
  const doc = await prisma.document.findUnique({
    where: { id: Number(req.params.id) },
    include: { createdBy: publicUserSelect },
  });
  if (!doc) throw notFound('Document introuvable');
  if (doc.projectId) await assertProjectAccess(req, doc.projectId);
  // Re-contrôle à la lecture : les lignes créées avant la validation à l'écriture peuvent
  // porter n'importe quelle clé, et c'est ici qu'elle deviendrait une URL présignée.
  // Type de réponse imposé : le PDF a été déposé par un PUT présigné, dont la signature ne
  // contraint pas le Content-Type. Sans cela un « PDF » en text/html s'exécuterait dans
  // l'iframe de la page Documents, sur l'origine de l'application.
  const fileUrl = isValidDocumentKey(doc.fileKey)
    ? await storage.getPresignedGetUrl(doc.fileKey, 3600, 'application/pdf')
    : null;
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
      title: string;
      kind: DocKind;
      content?: string;
      fileKey?: string;
      scope: DocScope;
      projectId?: number | null;
      scopeId?: number | null;
    };
    if (body.projectId) await assertProjectAccess(req, body.projectId);
    const doc = await prisma.document.create({
      data: {
        title: body.title,
        kind: body.kind,
        content: body.kind === DocKind.RICH ? sanitizeHtml(body.content ?? '') : null,
        fileKey: body.kind === DocKind.PDF && body.fileKey ? assertDocumentKey(body.fileKey) : null,
        scope: body.scope,
        projectId: body.projectId ?? null,
        scopeId: body.scopeId ?? null,
        createdById: req.user!.id,
      },
      include: { createdBy: publicUserSelect },
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
    if (existing.createdById !== req.user!.id && !isManager(req.user!.role))
      throw forbidden('Édition non autorisée');
    if (existing.projectId) await assertProjectAccess(req, existing.projectId);
    const body = req.body as {
      title?: string;
      content?: string;
      scope?: DocScope;
      projectId?: number | null;
      scopeId?: number | null;
    };
    // Déplacement : le projet de DESTINATION doit être accessible lui aussi. Ne vérifier
    // que le projet d'origine laisserait pousser un document dans un projet dont on n'est
    // pas membre (et l'y rendre visible à son équipe).
    if (body.projectId) await assertProjectAccess(req, body.projectId);
    const doc = await prisma.document.update({
      where: { id },
      data: {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.content !== undefined ? { content: sanitizeHtml(body.content) } : {}),
        ...(body.scope !== undefined ? { scope: body.scope } : {}),
        ...(body.projectId !== undefined ? { projectId: body.projectId } : {}),
        ...(body.scopeId !== undefined ? { scopeId: body.scopeId } : {}),
      },
      include: { createdBy: publicUserSelect },
    });
    res.json({ document: { ...doc, createdBy: await toPublicUser(doc.createdBy) } });
  },
);

// DELETE /api/documents/:id — auteur ou superviseur/admin
router.delete('/:id', validate({ params: z.object({ id: z.coerce.number().int() }) }), async (req, res) => {
  const id = Number(req.params.id);
  const existing = await prisma.document.findUnique({ where: { id } });
  if (!existing) throw notFound('Document introuvable');
  if (existing.createdById !== req.user!.id && !isManager(req.user!.role))
    throw forbidden('Suppression non autorisée');
  // Idem à la suppression : ne jamais effacer un objet hors du dossier des documents,
  // quelle que soit la clé enregistrée en base.
  if (isValidDocumentKey(existing.fileKey))
    await storage.deleteObject(existing.fileKey).catch(() => undefined);
  await prisma.document.delete({ where: { id } });
  res.status(204).end();
});

// POST /api/documents/pdf/presign — URL présignée pour l'upload d'un PDF
router.post(
  '/pdf/presign',
  validate({ body: z.object({ filename: z.string().min(1).max(200) }) }),
  async (req, res) => {
    if (req.user!.role === Role.CLIENT) throw forbidden('Réservé à l’équipe');
    const key = documentUploadKey((req.body as { filename: string }).filename);
    res.json({ url: await storage.getPresignedPutUrl(key, 'application/pdf', 900), key });
  },
);

export default router;
