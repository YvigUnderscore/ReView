// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { randomBytes } from 'node:crypto';
import { prisma } from '../lib/prisma';
import { encryptSecret } from '../lib/crypto';
import { isWebhookUrlAllowed } from '../lib/webhooks';
import { badRequest, notFound } from '../lib/errors';
import { logAudit } from './AuditService';

/**
 * Administration of the outgoing webhooks (36.D): what `routes/webhooks.routes` exposes, minus HTTP.
 * Deliveries themselves (queue, signature, replay) live in `WebhookService`.
 */

/** Columns returned to the administration — never the secret, shown only once at creation. */
export const hookSelect = {
  id: true,
  url: true,
  events: true,
  active: true,
  projectId: true,
  lastStatus: true,
  lastError: true,
  lastDeliveryAt: true,
  failureStreak: true,
  createdAt: true,
} as const;

export interface WebhookInput {
  url?: string;
  events?: string[];
  projectId?: number | null;
  active?: boolean;
}

/** The URL is refused if it targets the internal network; the project, if it does not exist. */
async function assertScope(url: string | undefined, projectId: number | null | undefined): Promise<void> {
  if (url && !isWebhookUrlAllowed(url))
    throw badRequest('Webhook URL refused (private or local host, or a non-HTTP scheme)', 'BAD_WEBHOOK_URL');
  if (projectId != null && !(await prisma.project.findUnique({ where: { id: projectId } })))
    throw notFound('Project not found');
}

/** A webhook, or a 404. */
export async function getHook(id: number) {
  const hook = await prisma.webhook.findUnique({ where: { id }, select: hookSelect });
  if (!hook) throw notFound('Webhook not found');
  return hook;
}

/** All webhooks, newest first. */
export function listHooks() {
  return prisma.webhook.findMany({ orderBy: { createdAt: 'desc' }, select: hookSelect });
}

/** Creates a webhook; its HMAC secret is returned in clear ONLY here, and stored encrypted. */
export async function createHook(
  actorId: number,
  input: { url: string; events: string[]; projectId?: number | null },
) {
  await assertScope(input.url, input.projectId);
  const secret = randomBytes(24).toString('hex');
  const webhook = await prisma.webhook.create({
    data: {
      url: input.url,
      events: input.events,
      projectId: input.projectId ?? null,
      secret: encryptSecret(secret),
    },
    select: hookSelect,
  });
  logAudit({
    userId: actorId,
    action: 'WEBHOOK_CREATE',
    entityType: 'Webhook',
    entityId: webhook.id,
    metadata: { url: input.url, events: input.events, projectId: input.projectId ?? null },
  });
  return { webhook, secret };
}

/** URL / events / scope / active. Re-enabling clears the failure streak. */
export async function updateHook(actorId: number, id: number, input: WebhookInput) {
  await assertScope(input.url, input.projectId);
  const existing = await getHook(id);
  const webhook = await prisma.webhook.update({
    where: { id: existing.id },
    // Re-enabling means starting from scratch: otherwise a webhook disabled after five failures
    // would be disabled again at the next failure.
    data: { ...input, ...(input.active === true ? { failureStreak: 0 } : {}) },
    select: hookSelect,
  });
  logAudit({
    userId: actorId,
    action: 'WEBHOOK_UPDATE',
    entityType: 'Webhook',
    entityId: existing.id,
    metadata: { ...input },
  });
  return webhook;
}

/** Deletes a webhook (and, by cascade, its delivery log). */
export async function deleteHook(actorId: number, id: number): Promise<void> {
  const existing = await getHook(id);
  await prisma.webhook.delete({ where: { id: existing.id } });
  logAudit({
    userId: actorId,
    action: 'WEBHOOK_DELETE',
    entityType: 'Webhook',
    entityId: existing.id,
    metadata: { url: existing.url },
  });
}
