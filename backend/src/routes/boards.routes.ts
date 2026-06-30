import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { Role, type Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { authenticate } from '../middleware/auth';
import { assertProjectAccess } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import { resolveProjectIdForAsset } from '../lib/pipeline';
import { emitToProject } from '../services/SocketService';
import { forbidden, notFound } from '../lib/errors';

/**
 * Boards mood/reference (9.B) — un board par Projet et un board par Asset (Excalidraw).
 * Persistance + journal des modifications. Sync simple (sauvegarde + reload).
 */
const router = Router();
router.use(authenticate);

type Scope = { projectId: number } | { assetId: number };

const ownerProjectId = async (scope: Scope): Promise<number | null> =>
  'projectId' in scope ? scope.projectId : resolveProjectIdForAsset(scope.assetId);

async function readBoard(req: Request, res: Response, scope: Scope): Promise<void> {
  const projectId = await ownerProjectId(scope);
  if (!projectId) throw notFound('Cible introuvable');
  await assertProjectAccess(req, projectId);
  const board = await prisma.board.findUnique({ where: scope });
  res.json({ board: board ?? { ...scope, document: {}, updatedAt: null } });
}

async function writeBoard(req: Request, res: Response, scope: Scope): Promise<void> {
  const projectId = await ownerProjectId(scope);
  if (!projectId) throw notFound('Cible introuvable');
  await assertProjectAccess(req, projectId);
  if (req.user!.role === Role.CLIENT) throw forbidden('Lecture seule pour les clients');

  const { document, summary } = req.body as { document: Prisma.InputJsonValue; summary?: string };
  const board = await prisma.board.upsert({
    where: scope,
    update: { document },
    create: { ...scope, document },
  });
  await prisma.boardChange.create({
    data: { boardId: board.id, userId: req.user!.id, summary: summary ?? 'Mise à jour du board' },
  });
  emitToProject(projectId, 'board:update', { ...scope, updatedAt: board.updatedAt, by: req.user!.id });
  res.json({ board });
}

const idParam = (key: 'projectId' | 'assetId') => validate({ params: z.object({ [key]: z.coerce.number().int() }) });
const bodySchema = validate({ body: z.object({ document: z.any(), summary: z.string().max(500).optional() }) });

// ── Board projet ─────────────────────────────────────────────────────────────
router.get('/project/:projectId', idParam('projectId'), (req, res) => readBoard(req, res, { projectId: Number(req.params.projectId) }));
router.put('/project/:projectId', idParam('projectId'), bodySchema, (req, res) => writeBoard(req, res, { projectId: Number(req.params.projectId) }));

// ── Board asset ──────────────────────────────────────────────────────────────
router.get('/asset/:assetId', idParam('assetId'), (req, res) => readBoard(req, res, { assetId: Number(req.params.assetId) }));
router.put('/asset/:assetId', idParam('assetId'), bodySchema, (req, res) => writeBoard(req, res, { assetId: Number(req.params.assetId) }));

export default router;
