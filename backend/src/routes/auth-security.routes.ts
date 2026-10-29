// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { revokeSession } from '../lib/sessions';
import { API_SCOPES } from '../lib/apiTokens';
import { ALL_SCOPES } from '../lib/apiScopes';
import * as ApiTokenService from '../services/ApiTokenService';
import { logAudit } from '../services/AuditService';
import { badRequest, notFound, unauthorized } from '../lib/errors';

/**
 * Account security (36.B/36.C): active sessions and personal API tokens.
 * Mounted under /api/auth (like auth.routes): all routes require a JWT.
 */
const router = Router();
router.use(authenticate);

// GET /api/auth/sessions — active sessions of the account (the current one marked `current`)
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

// DELETE /api/auth/sessions/:sid — revokes one of ITS sessions (the current one = logout)
router.delete(
  '/sessions/:sid',
  validate({ params: z.object({ sid: z.string().length(32) }) }),
  async (req, res) => {
    const ok = await revokeSession(String(req.params.sid), req.user!.id);
    if (!ok) throw notFound('Session not found');
    logAudit({ userId: req.user!.id, action: 'SESSION_REVOKE', entityType: 'UserSession' });
    res.status(204).end();
  },
);

// POST /api/auth/logout — revokes the current session (the associated JWTs die with it)
router.post('/logout', async (req, res) => {
  if (req.sessionId) await revokeSession(req.sessionId, req.user!.id);
  res.status(204).end();
});

// ── Personal API tokens (36.C) ───────────────────────────────────────────

// GET /api/auth/tokens — active tokens of the account (never the secret)
router.get('/tokens', async (req, res) => {
  const tokens = await prisma.apiToken.findMany({
    where: { userId: req.user!.id, revokedAt: null },
    orderBy: { createdAt: 'desc' },
    select: ApiTokenService.tokenSelect,
  });
  res.json({ tokens });
});

// POST /api/auth/tokens — creates a token; the secret is returned ONLY HERE, once
router.post(
  '/tokens',
  validate({
    body: z.object({
      name: z.string().trim().min(1).max(80),
      description: z.string().trim().max(300).optional(),
      // Fine-grained scopes (`versions:write`…) or legacy ones (`read`/`write`, expanded on use).
      scopes: z.array(z.string().max(40)).min(1).default(['read']),
      expiresInDays: z.number().int().positive().max(3650).optional(),
      // Optional confinement to a project.
      projectId: z.number().int().positive().optional(),
      /** Current password: required, as for changing the email or the password. */
      currentPassword: z.string().max(128).optional(),
    }),
  }),
  async (req, res) => {
    // An API token must not be able to create others (no escalation).
    if (req.apiToken) throw badRequest('An API token cannot create another token');
    const body = req.body as ApiTokenService.CreateTokenInput & { currentPassword?: string };

    // Re-authentication: a `rvk_` lives for up to 3650 days and survives closing the tab. Forged from a
    // stolen access token, it turns a passing session theft into durable access, which "log out
    // everywhere" does not even suspect. The password is the only thing the attacker does not have.
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) throw unauthorized();
    if (!body.currentPassword || !(await bcrypt.compare(body.currentPassword, user.password))) {
      throw unauthorized('The current password is required', 'CURRENT_PASSWORD_REQUIRED');
    }

    res.status(201).json(await ApiTokenService.createPersonal(req.user!.id, body));
  },
);

// GET /api/auth/scopes — catalog of assignable scopes (helps create a token)
router.get('/scopes', (_req, res) => {
  res.json({ scopes: ALL_SCOPES, legacy: API_SCOPES });
});

// DELETE /api/auth/tokens/:id — revokes one of ITS tokens
router.delete(
  '/tokens/:id',
  validate({ params: z.object({ id: z.coerce.number().int() }) }),
  async (req, res) => {
    const r = await prisma.apiToken.updateMany({
      where: { id: Number(req.params.id), userId: req.user!.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (r.count === 0) throw notFound('Token not found');
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
