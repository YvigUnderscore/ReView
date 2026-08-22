// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { authenticate } from '../middleware/auth';
import { assertProjectAccess } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import { resolveProjectIdForAsset } from '../lib/pipeline';
import { assertProjectWritable } from '../lib/projectGuard';
import { emitToProject } from '../services/SocketService';
import { forbidden, notFound } from '../lib/errors';
import {
  boardDocumentSchema,
  fileIdSchema,
  presignBoardFiles,
  readBoard,
  writeBoard,
  type BoardDocument,
  type BoardScope,
} from '../services/BoardService';

/**
 * Boards mood/reference (9.B) — un board par Projet et un board par Asset (Excalidraw).
 * Le document est validé par un schéma borné, les images vivent dans MinIO et l'écriture
 * est conditionnée à l'`updatedAt` chargé par l'éditeur (409 `BOARD_CONFLICT` sinon) :
 * toute la mécanique est dans `services/BoardService`. Il exista un journal `BoardChange`,
 * retiré en 2026-08 — une ligne par sauvegarde autosauvée (1,2 s de débounce) que rien
 * ne relisait jamais.
 */
const router = Router();
router.use(authenticate);

const ownerProjectId = async (scope: BoardScope): Promise<number | null> =>
  'projectId' in scope ? scope.projectId : resolveProjectIdForAsset(scope.assetId);

/** Accès au board, et pour une écriture : projet non archivé + compte contributeur. */
async function guard(req: Request, scope: BoardScope, write: boolean): Promise<number> {
  const projectId = await ownerProjectId(scope);
  if (!projectId) throw notFound('Target not found');
  await assertProjectAccess(req, projectId);
  if (write) {
    await assertProjectWritable(projectId); // 38.B : projet archivé = lecture seule
    if (req.user!.role === Role.CLIENT) throw forbidden('Read-only for clients');
  }
  return projectId;
}

async function handleRead(req: Request, res: Response, scope: BoardScope): Promise<void> {
  const projectId = await guard(req, scope, false);
  res.json(await readBoard(projectId, scope));
}

async function handleWrite(req: Request, res: Response, scope: BoardScope): Promise<void> {
  const projectId = await guard(req, scope, true);
  const { document, baseUpdatedAt } = req.body as {
    document: BoardDocument;
    baseUpdatedAt: string | null;
  };
  const board = await writeBoard(scope, document, baseUpdatedAt);
  emitToProject(projectId, 'board:update', { ...scope, updatedAt: board.updatedAt, by: req.user!.id });
  res.json({ board });
}

async function handlePresign(req: Request, res: Response, scope: BoardScope): Promise<void> {
  const projectId = await guard(req, scope, true);
  const { files } = req.body as { files: { id: string; mimeType: string }[] };
  res.json({ uploads: await presignBoardFiles(projectId, scope, files) });
}

// ── Schémas ──────────────────────────────────────────────────────────────────
const idParam = (key: 'projectId' | 'assetId') =>
  validate({ params: z.object({ [key]: z.coerce.number().int() }) });

/**
 * `baseUpdatedAt` est **obligatoire** : c'est l'horodatage sur lequel l'éditeur a chargé le
 * board (`null` s'il n'existait pas encore). Le rendre facultatif rouvrirait l'écrasement
 * silencieux pour tout client qui l'oublie.
 */
const bodySchema = validate({
  body: z.object({
    document: boardDocumentSchema,
    baseUpdatedAt: z.string().datetime().nullable(),
  }),
});

const filesSchema = validate({
  body: z.object({
    files: z
      .array(z.object({ id: fileIdSchema, mimeType: z.string().min(1).max(80) }))
      .min(1)
      .max(20),
  }),
});

// ── Board projet ─────────────────────────────────────────────────────────────
router.get('/project/:projectId', idParam('projectId'), (req, res) =>
  handleRead(req, res, { projectId: Number(req.params.projectId) }),
);
router.put('/project/:projectId', idParam('projectId'), bodySchema, (req, res) =>
  handleWrite(req, res, { projectId: Number(req.params.projectId) }),
);
router.post('/project/:projectId/files', idParam('projectId'), filesSchema, (req, res) =>
  handlePresign(req, res, { projectId: Number(req.params.projectId) }),
);

// ── Board asset ──────────────────────────────────────────────────────────────
router.get('/asset/:assetId', idParam('assetId'), (req, res) =>
  handleRead(req, res, { assetId: Number(req.params.assetId) }),
);
router.put('/asset/:assetId', idParam('assetId'), bodySchema, (req, res) =>
  handleWrite(req, res, { assetId: Number(req.params.assetId) }),
);
router.post('/asset/:assetId/files', idParam('assetId'), filesSchema, (req, res) =>
  handlePresign(req, res, { assetId: Number(req.params.assetId) }),
);

export default router;
