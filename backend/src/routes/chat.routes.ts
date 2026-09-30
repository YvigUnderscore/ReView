// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import * as ChatService from '../services/ChatService';

/**
 * Messagerie interne : messages privés et groupes de discussion.
 * Aucun contrôle de rôle — un fil est privé à ses membres, l'appartenance EST le droit
 * d'accès (vérifiée dans le service, pas ici, pour qu'aucune route ne puisse l'oublier).
 */
const router = Router();
router.use(authenticate);

const idParam = z.object({ id: z.coerce.number().int() });

// GET /api/chat/conversations — fils de l'utilisateur, le plus actif d'abord
router.get('/conversations', async (req, res) => {
  res.json({ conversations: await ChatService.listConversations(req.user!.id) });
});

// GET /api/chat/unread — total de non-lus (pastille de la sidebar)
router.get('/unread', async (req, res) => {
  res.json({ unread: await ChatService.countUnread(req.user!.id) });
});

// POST /api/chat/conversations — MP (un destinataire) ou groupe (titre ou 2+ destinataires)
router.post(
  '/conversations',
  validate({
    body: z.object({
      userIds: z.array(z.number().int()).min(1).max(50),
      title: z.string().max(120).nullable().optional(),
    }),
  }),
  async (req, res) => {
    const body = req.body as { userIds: number[]; title?: string | null };
    res.status(201).json({ conversation: await ChatService.createConversation(req.user!.id, body) });
  },
);

// GET /api/chat/conversations/:id — un fil (membres, non-lus, dernier message)
router.get('/conversations/:id', validate({ params: idParam }), async (req, res) => {
  const conversation = await ChatService.conversationViewFor(Number(req.params.id), req.user!.id);
  res.json({ conversation });
});

// GET /api/chat/conversations/:id/messages?before=&limit= — page de messages
router.get(
  '/conversations/:id/messages',
  validate({
    params: idParam,
    query: z.object({
      before: z.coerce.number().int().optional(),
      limit: z.coerce.number().int().min(1).max(100).optional(),
    }),
  }),
  async (req, res) => {
    // Express 5 : `req.query` est un getter, la coercition du middleware n'y persiste pas.
    const q = req.query as { before?: string; limit?: string };
    const messages = await ChatService.listMessages(Number(req.params.id), req.user!.id, {
      before: q.before ? Number(q.before) : undefined,
      limit: q.limit ? Number(q.limit) : undefined,
    });
    res.json({ messages });
  },
);

// POST /api/chat/conversations/:id/messages — écrire dans le fil
router.post(
  '/conversations/:id/messages',
  validate({
    params: idParam,
    body: z.object({ body: z.string().min(1).max(ChatService.MESSAGE_MAX_LENGTH) }),
  }),
  async (req, res) => {
    const message = await ChatService.sendMessage(
      Number(req.params.id),
      req.user!.id,
      (req.body as { body: string }).body,
    );
    res.status(201).json({ message });
  },
);

// POST /api/chat/conversations/:id/read — marque le fil lu
router.post('/conversations/:id/read', validate({ params: idParam }), async (req, res) => {
  res.json(await ChatService.markRead(Number(req.params.id), req.user!.id));
});

// PATCH /api/chat/conversations/:id — renommer le groupe et/ou couper la sourdine
router.patch(
  '/conversations/:id',
  validate({
    params: idParam,
    body: z.object({ title: z.string().max(120).optional(), muted: z.boolean().optional() }),
  }),
  async (req, res) => {
    const id = Number(req.params.id);
    const body = req.body as { title?: string; muted?: boolean };
    if (body.muted !== undefined) await ChatService.setMuted(id, req.user!.id, body.muted);
    if (body.title !== undefined) {
      res.json({ conversation: await ChatService.renameConversation(id, req.user!.id, body.title) });
      return;
    }
    res.json({ conversation: await ChatService.conversationViewFor(id, req.user!.id) });
  },
);

// POST /api/chat/conversations/:id/members — inviter dans le fil
router.post(
  '/conversations/:id/members',
  validate({ params: idParam, body: z.object({ userIds: z.array(z.number().int()).min(1).max(50) }) }),
  async (req, res) => {
    const conversation = await ChatService.addMembers(
      Number(req.params.id),
      req.user!.id,
      (req.body as { userIds: number[] }).userIds,
    );
    res.json({ conversation });
  },
);

// DELETE /api/chat/conversations/:id/members/:userId — retirer quelqu'un / quitter le fil
router.delete(
  '/conversations/:id/members/:userId',
  validate({ params: idParam.extend({ userId: z.coerce.number().int() }) }),
  async (req, res) => {
    await ChatService.removeMember(Number(req.params.id), req.user!.id, Number(req.params.userId));
    res.status(204).end();
  },
);

// DELETE /api/chat/messages/:id — suppression douce par l'auteur
router.delete('/messages/:id', validate({ params: idParam }), async (req, res) => {
  await ChatService.deleteMessage(Number(req.params.id), req.user!.id);
  res.status(204).end();
});

export default router;
