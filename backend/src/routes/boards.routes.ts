// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { Role, type Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { authenticate } from '../middleware/auth';
import { assertProjectAccess } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import { resolveProjectIdForAsset } from '../lib/pipeline';
import { assertProjectWritable } from '../lib/projectGuard';
import { emitToProject } from '../services/SocketService';
import { forbidden, notFound } from '../lib/errors';

/**
 * Boards mood/reference (9.B) — un board par Projet et un board par Asset (Excalidraw).
 * Persistance seule, sync simple (sauvegarde + reload) : le board porte son propre
 * `updatedAt` et le document Excalidraw fait foi. Il exista un journal `BoardChange`,
 * retiré en 2026-08 — une ligne par sauvegarde autosauvée (1,2 s de débounce) que rien
 * ne relisait jamais.
 */
const router = Router();
router.use(authenticate);

type Scope = { projectId: number } | { assetId: number };

const ownerProjectId = async (scope: Scope): Promise<number | null> =>
  'projectId' in scope ? scope.projectId : resolveProjectIdForAsset(scope.assetId);

async function readBoard(req: Request, res: Response, scope: Scope): Promise<void> {
  const projectId = await ownerProjectId(scope);
  if (!projectId) throw notFound('Target not found');
  await assertProjectAccess(req, projectId);
  const board = await prisma.board.findUnique({ where: scope });
  res.json({ board: board ?? { ...scope, document: {}, updatedAt: null } });
}

async function writeBoard(req: Request, res: Response, scope: Scope): Promise<void> {
  const projectId = await ownerProjectId(scope);
  if (!projectId) throw notFound('Target not found');
  await assertProjectAccess(req, projectId);
  await assertProjectWritable(projectId); // 38.B : projet archivé = lecture seule
  if (req.user!.role === Role.CLIENT) throw forbidden('Read-only for clients');

  const { document } = req.body as { document: Prisma.InputJsonValue };
  const board = await prisma.board.upsert({
    where: scope,
    update: { document },
    create: { ...scope, document },
  });
  emitToProject(projectId, 'board:update', { ...scope, updatedAt: board.updatedAt, by: req.user!.id });
  res.json({ board });
}

const idParam = (key: 'projectId' | 'assetId') =>
  validate({ params: z.object({ [key]: z.coerce.number().int() }) });
const bodySchema = validate({ body: z.object({ document: z.any() }) });

// ── Board projet ─────────────────────────────────────────────────────────────
router.get('/project/:projectId', idParam('projectId'), (req, res) =>
  readBoard(req, res, { projectId: Number(req.params.projectId) }),
);
router.put('/project/:projectId', idParam('projectId'), bodySchema, (req, res) =>
  writeBoard(req, res, { projectId: Number(req.params.projectId) }),
);

// ── Board asset ──────────────────────────────────────────────────────────────
router.get('/asset/:assetId', idParam('assetId'), (req, res) =>
  readBoard(req, res, { assetId: Number(req.params.assetId) }),
);
router.put('/asset/:assetId', idParam('assetId'), bodySchema, (req, res) =>
  writeBoard(req, res, { assetId: Number(req.params.assetId) }),
);

export default router;
