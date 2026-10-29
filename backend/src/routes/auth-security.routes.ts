// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireUser } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { listActiveSessions, revokeSession } from '../lib/sessions';
import { clearRefreshCookie } from '../lib/refreshCookie';
import { API_SCOPES } from '../lib/apiTokens';
import { ALL_SCOPES } from '../lib/apiScopes';
import * as ApiTokenService from '../services/ApiTokenService';
import { logAudit } from '../services/AuditService';
import { badRequest, notFound } from '../lib/errors';

/**
 * Account security (36.B/36.C): active sessions and personal API tokens.
 * Mounted under /api/auth (like auth.routes): all routes require a JWT.
 */
const router = Router();
router.use(authenticate);

// GET /api/auth/sessions — active sessions of the account (the current one marked `current`)
router.get('/sessions', async (req, res) => {
  const sessions = await listActiveSessions(requireUser(req).id);
  res.json({
    sessions: sessions.map((s) => ({ ...s, current: s.id === req.sessionId })),
  });
});

// DELETE /api/auth/sessions/:sid — revokes one of ITS sessions (the current one = logout)
router.delete(
  '/sessions/:sid',
  validate({ params: z.object({ sid: z.string().length(32) }) }),
  async (req, res) => {
    const ok = await revokeSession(String(req.params.sid), requireUser(req).id);
    if (!ok) throw notFound('Session not found');
    logAudit({ userId: requireUser(req).id, action: 'SESSION_REVOKE', entityType: 'UserSession' });
    res.status(204).end();
  },
);

// POST /api/auth/logout — revokes the current session (the associated JWTs die with it)
router.post('/logout', async (req, res) => {
  if (req.sessionId) await revokeSession(req.sessionId, requireUser(req).id);
  clearRefreshCookie(req, res);
  res.status(204).end();
});

// ── Personal API tokens (36.C) ───────────────────────────────────────────

// GET /api/auth/tokens — active tokens of the account (never the secret)
router.get('/tokens', async (req, res) => {
  res.json({ tokens: await ApiTokenService.listPersonal(requireUser(req).id) });
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
    // stolen access token, it turns a passing session theft into durable access. A 403, not a 401: the
    // caller is authenticated, it is the action that is refused (a 401 would trigger session renewal).
    await ApiTokenService.assertActorPassword(requireUser(req).id, body.currentPassword);

    res.status(201).json(await ApiTokenService.createPersonal(requireUser(req).id, body));
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
    await ApiTokenService.revokePersonal(requireUser(req).id, Number(req.params.id));
    res.status(204).end();
  },
);

export default router;
