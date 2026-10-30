// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { authenticate, requireUser } from '../middleware/auth';
import { assertProjectAccess } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import { resolveProjectIdForAsset } from '../lib/pipeline';
import { assertProjectWritable } from '../lib/projectGuard';
import { assertCanContribute } from '../lib/projectRoles';
import { emitToProject } from '../services/SocketService';
import { notFound } from '../lib/errors';
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
 * Mood and reference boards (9.B): one board per project and one board per asset (Excalidraw).
 * The document is validated by a bounded schema, images live in MinIO, and the write is conditioned
 * on the `updatedAt` loaded by the editor (409 `BOARD_CONFLICT` otherwise): all the mechanics are in
 * `services/BoardService`. There used to be a `BoardChange` log, removed in 2026-08: one line per
 * autosave (1.2 s debounce) that nothing ever read back.
 */
const router = Router();
router.use(authenticate);

const ownerProjectId = async (scope: BoardScope): Promise<number | null> =>
  'projectId' in scope ? scope.projectId : resolveProjectIdForAsset(scope.assetId);

/** Access to the board, and for a write: non-archived project plus a contributing account. */
async function guard(req: Request, scope: BoardScope, write: boolean): Promise<number> {
  const projectId = await ownerProjectId(scope);
  if (!projectId) throw notFound('Target not found');
  await assertProjectAccess(req, projectId);
  if (write) {
    await assertProjectWritable(projectId); // 38.B: archived project = read-only
    // 38.E: EFFECTIVE role on THIS project. The global role let an ARTIST demoted to CLIENT write here,
    // their membership being enough to pass `assertProjectAccess`.
    await assertCanContribute(requireUser(req).id, requireUser(req).role, projectId);
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
  emitToProject(projectId, 'board:update', { ...scope, updatedAt: board.updatedAt, by: requireUser(req).id });
  res.json({ board });
}

async function handlePresign(req: Request, res: Response, scope: BoardScope): Promise<void> {
  const projectId = await guard(req, scope, true);
  const { files } = req.body as { files: { id: string; mimeType: string }[] };
  res.json({ uploads: await presignBoardFiles(projectId, scope, files) });
}

// ── Schemas ──────────────────────────────────────────────────────────────────
const idParam = (key: 'projectId' | 'assetId') =>
  validate({ params: z.object({ [key]: z.coerce.number().int() }) });

/**
 * `baseUpdatedAt` is **mandatory**: it is the timestamp on which the editor loaded the board (`null`
 * if it did not exist yet). Making it optional would reopen silent overwriting for any client that
 * forgets it.
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

// ── Project board ─────────────────────────────────────────────────────────────
router.get('/project/:projectId', idParam('projectId'), (req, res) =>
  handleRead(req, res, { projectId: Number(req.params.projectId) }),
);
router.put('/project/:projectId', idParam('projectId'), bodySchema, (req, res) =>
  handleWrite(req, res, { projectId: Number(req.params.projectId) }),
);
router.post('/project/:projectId/files', idParam('projectId'), filesSchema, (req, res) =>
  handlePresign(req, res, { projectId: Number(req.params.projectId) }),
);

// ── Asset board ──────────────────────────────────────────────────────────────
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
