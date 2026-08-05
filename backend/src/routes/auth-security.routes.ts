// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { revokeSession } from '../lib/sessions';
import { API_SCOPES } from '../lib/apiTokens';
import { ALL_SCOPES } from '../lib/apiScopes';
import * as ApiTokenService from '../services/ApiTokenService';
import { logAudit } from '../services/AuditService';
import { badRequest, notFound } from '../lib/errors';

/**
 * Sécurité du compte (36.B/36.C) : sessions actives et tokens d'API personnels.
 * Monté sous /api/auth (comme auth.routes) — toutes les routes exigent un JWT.
 */
const router = Router();
router.use(authenticate);

// GET /api/auth/sessions — sessions actives du compte (l'actuelle marquée `current`)
router.get('/sessions', async (req, res) => {
  const sessions = await prisma.userSession.findMany({
    where: { userId: req.user!.id, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { lastSeenAt: 'desc' },
    select: { id: true, userAgent: true, ip: true, createdAt: true, lastSeenAt: true },
  });
  res.json({
    sessions: sessions.map((s) => ({ ...s, current: s.id === req.sessionId })),
  });
});

// DELETE /api/auth/sessions/:sid — révoque une de SES sessions (l'actuelle = déconnexion)
router.delete(
  '/sessions/:sid',
  validate({ params: z.object({ sid: z.string().length(32) }) }),
  async (req, res) => {
    const ok = await revokeSession(String(req.params.sid), req.user!.id);
    if (!ok) throw notFound('Session introuvable');
    logAudit({ userId: req.user!.id, action: 'SESSION_REVOKE', entityType: 'UserSession' });
    res.status(204).end();
  },
);

// POST /api/auth/logout — révoque la session courante (les JWT associés meurent avec)
router.post('/logout', async (req, res) => {
  if (req.sessionId) await revokeSession(req.sessionId, req.user!.id);
  res.status(204).end();
});

// ── Tokens d'API personnels (36.C) ───────────────────────────────────────────

// GET /api/auth/tokens — tokens actifs du compte (jamais le secret)
router.get('/tokens', async (req, res) => {
  const tokens = await prisma.apiToken.findMany({
    where: { userId: req.user!.id, revokedAt: null },
    orderBy: { createdAt: 'desc' },
    select: ApiTokenService.tokenSelect,
  });
  res.json({ tokens });
});

// POST /api/auth/tokens — crée un token ; le secret n'est renvoyé qu'ICI, une seule fois
router.post(
  '/tokens',
  validate({
    body: z.object({
      name: z.string().trim().min(1).max(80),
      description: z.string().trim().max(300).optional(),
      // Scopes fins (`versions:write`…) ou hérités (`read`/`write`, développés à l'usage).
      scopes: z.array(z.string().max(40)).min(1).default(['read']),
      expiresInDays: z.number().int().positive().max(3650).optional(),
      // Cantonnement facultatif à un projet.
      projectId: z.number().int().positive().optional(),
    }),
  }),
  async (req, res) => {
    // Un token d'API ne doit pas pouvoir en fabriquer d'autres (pas d'escalade).
    if (req.apiToken) throw badRequest("Un token d'API ne peut pas créer de token");
    const body = req.body as ApiTokenService.CreateTokenInput;
    res.status(201).json(await ApiTokenService.createPersonal(req.user!.id, body));
  },
);

// GET /api/auth/scopes — catalogue des scopes attribuables (aide à la création de token)
router.get('/scopes', (_req, res) => {
  res.json({ scopes: ALL_SCOPES, legacy: API_SCOPES });
});

// DELETE /api/auth/tokens/:id — révoque un de SES tokens
router.delete(
  '/tokens/:id',
  validate({ params: z.object({ id: z.coerce.number().int() }) }),
  async (req, res) => {
    const r = await prisma.apiToken.updateMany({
      where: { id: Number(req.params.id), userId: req.user!.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (r.count === 0) throw notFound('Token introuvable');
    logAudit({
      userId: req.user!.id,
      action: 'API_TOKEN_REVOKE',
      entityType: 'ApiToken',
      entityId: Number(req.params.id),
    });
    res.status(204).end();
  },
);

export default router;
