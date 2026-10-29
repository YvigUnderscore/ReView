// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { WatchTargetType } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { badRequest, forbidden, notFound } from '../lib/errors';
import { assertProjectWritable } from '../lib/projectGuard';
import { isProjectManager } from '../lib/projectRoles';
import {
  checkReviewNote,
  resolveProjectSettingsById,
  reviewNoteSchema,
  REVIEW_NOTE_MAX_LENGTH,
  type ReviewRequestRule,
} from '../lib/projectSettings';
import type { SessionUser } from '../lib/shotgridAccess';
import { logAudit } from './AuditService';
import { notify } from './NotificationService';
import { setWatch } from './WatchService';
import { emitToProject } from './SocketService';
import { publish as publishApiEvent } from './ApiEventService';
import {
  ASSIGNEE_SELECT,
  assertAssignable,
  toAssigneeView,
  type AssigneeView,
} from './EntityAssigneeService';

/**
 * Who must review this version (Phase 49), and **what they must look at**.
 *
 * The review decision already existed (`ReviewDecisionService`): it records what was concluded
 * about a delivery. What was missing was the step before it: **assigning** the delivery to someone.
 * That used to be said out loud or in a discussion thread, so it got lost: nobody could open ReView
 * and answer "what is expected of me?". The "Assigned to me" panel on the Reviews page reads exactly that list.
 *
 * The useful half was still missing. Knowing you are expected without knowing WHAT to look at only
 * saves time for the person assigning: the recipient would open four minutes of playblast without
 * knowing whether they were asked about the lighting, the timing or the match. Every assignment
 * therefore carries an **instruction**, and it is what makes the difference between "look at this"
 * and "check the match at 1042, the rest is approved".
 *
 * Two project rules govern it (`settings.reviewRequest`): whether it is required, and a minimum
 * length. They are enforced **here**, not in the route: the same assignment arrives from the decision
 * screen, from publishing a draft, and from the integration API. Three entry points for one business
 * rule would be three chances to forget it.
 *
 * Assigning grants and removes no rights: it is an expectation, not a delegation. The decision stays
 * reserved to the project supervisor, and an artist assigned to a version reviews and comments on it,
 * as they could already do.
 */

/** Beyond this, it is no longer an assignment but a broadcast: this is what the playlist is for. */
export const MAX_REVIEWERS = 20;

/**
 * A review expectation, as the API returns it: the person (same shape as everywhere else) and the
 * instruction written FOR THEM.
 *
 * The instruction sits flat on the person rather than in a wrapping object: the screens that already
 * displayed the list (`AssigneeStack`, the "Assigned to me" panel) read it unchanged, and those that
 * want the instruction find it in the same place.
 */
export type ReviewerView = AssigneeView & { note: string | null };

/** What a caller provides to assign a version to someone. */
export interface ReviewerInput {
  userId: number;
  note?: string | null;
}

/**
 * The list as the THREE write entry points accept it: the decision screen, publishing a draft, and
 * the integration API. One schema for all three: three copies would have diverged at the first
 * changed bound, and the forgotten entry point would have accepted what the other two refuse.
 *
 * It lives here and not in `lib/projectSettings` because `MAX_REVIEWERS` bounds it, and that bound
 * is a rule of assignment, not of the instruction setting.
 */
export const reviewersSchema = z
  .array(z.object({ userId: z.number().int().positive(), note: reviewNoteSchema }))
  .max(MAX_REVIEWERS);

/** The version, its project, its author, and what is needed to write the notification. */
async function loadVersion(versionId: number) {
  const version = await prisma.version.findFirst({
    where: { id: versionId, deletedAt: null },
    select: { id: true, name: true, taskId: true, assetId: true, authorId: true },
  });
  if (!version) throw notFound('Version not found');
  return version;
}

const SELECT = { note: true, reviewer: { select: ASSIGNEE_SELECT } } as const;

/** The people assigned to this version, with signed photos. Stable order (by id). */
export async function listReviewers(versionId: number): Promise<ReviewerView[]> {
  const rows = await prisma.reviewAssignment.findMany({
    where: { versionId },
    orderBy: { reviewerId: 'asc' },
    select: SELECT,
  });
  return Promise.all(rows.map(async (row) => ({ ...(await toAssigneeView(row.reviewer)), note: row.note })));
}

/**
 * Who may assign a review, and therefore write the instruction.
 *
 * The project manager, obviously: distributing reviews is their job. But also
 * **the version's author**: they just delivered it, they know what there is to look at, and the
 * instruction is worth the most at upload time. Refusing it to them would have turned "instruction
 * required at upload" into a rule the uploader could not satisfy.
 *
 * This grants no decision right: the artist chooses who looks, but does not conclude the review (38.E).
 */
async function assertCanAssign(
  actor: SessionUser,
  projectId: number,
  authorId: number | null,
): Promise<void> {
  await assertProjectWritable(projectId);
  if (actor.id === authorId) return;
  if (!(await isProjectManager(actor.id, actor.role, projectId)))
    throw forbidden('Only the author of this version or a project manager can assign its review');
}

/**
 * Normalizes an instruction and checks it against the project rule.
 *
 * Whitespace alone does not make an instruction: it is measured after `trim`, and an empty instruction
 * is stored as `null` rather than as an empty string. Two representations of the same nothing would
 * have produced two different displays depending on the entry point.
 */
export function normalizeNote(note: string | null | undefined, rule: ReviewRequestRule): string | null {
  const verdict = checkReviewNote(note, rule);
  if (verdict === 'missing')
    throw badRequest('This project requires a brief when assigning a review', 'REVIEW_NOTE_REQUIRED');
  if (verdict === 'too-short')
    throw badRequest(
      `A reviewer brief must be at least ${rule.minNoteLength} characters`,
      'REVIEW_NOTE_TOO_SHORT',
    );
  const text = (note ?? '').trim();
  return text ? text.slice(0, REVIEW_NOTE_MAX_LENGTH) : null;
}

/**
 * Replaces the list of people in charge of a version's review, instructions included.
 *
 * Replacement, not addition: the caller sends the list it wants to see, and two concurrent saves cannot
 * leave a ghost assignee that nobody chose. Same trade-off as `EntityAssigneeService.setAssignees`, and
 * same guard on who may receive work, otherwise one of the two paths would become the back door of the other.
 *
 * A person already assigned has their instruction updated instead of being removed and re-added: otherwise
 * they would be notified on every save, and resubscribed to a version they may have unsubscribed from.
 */
export async function setReviewers(
  actor: SessionUser,
  projectId: number,
  versionId: number,
  entries: ReviewerInput[],
): Promise<ReviewerView[]> {
  const version = await loadVersion(versionId);
  await assertCanAssign(actor, projectId, version.authorId);

  // The same person listed twice is not an error to reject: the last instruction wins,
  // as on screen where the second row overwrites the first.
  const rule = (await resolveProjectSettingsById(projectId)).reviewRequest;
  const wanted = new Map<number, string | null>();
  for (const entry of entries) wanted.set(entry.userId, normalizeNote(entry.note, rule));
  await assertAssignable(projectId, [...wanted.keys()]);

  const previous = await prisma.reviewAssignment.findMany({
    where: { versionId },
    select: { reviewerId: true, note: true },
  });
  const before = new Map(previous.map((row) => [row.reviewerId, row.note]));

  await prisma.$transaction([
    prisma.reviewAssignment.deleteMany({ where: { versionId, reviewerId: { notIn: [...wanted.keys()] } } }),
    ...[...wanted].map(([reviewerId, note]) =>
      prisma.reviewAssignment.upsert({
        where: { versionId_reviewerId: { versionId, reviewerId } },
        create: { versionId, reviewerId, note, assignedById: actor.id },
        update: { note, assignedById: actor.id },
      }),
    ),
  ]);

  // Only notify what changed FOR THE PERSON: a new assignment, or a rewritten instruction.
  // Saving the same list again without touching it wakes nobody.
  const added: number[] = [];
  const rewritten: number[] = [];
  for (const [reviewerId, note] of wanted) {
    if (reviewerId === actor.id) continue;
    if (!before.has(reviewerId)) added.push(reviewerId);
    else if (before.get(reviewerId) !== note) rewritten.push(reviewerId);
  }
  if (added.length > 0) await announce(added, projectId, version, 'assigned');
  if (rewritten.length > 0) await announce(rewritten, projectId, version, 'note');

  return afterWrite(actor, projectId, version, [...wanted.keys()]);
}

/**
 * Rewrites the instruction of a person already assigned, without touching the rest of the list.
 *
 * This is the common after-the-fact step ("add what they need to look at"). Going through `setReviewers`
 * would have required sending the whole list back, hence re-reading it, and two open screens would have
 * overwritten each other.
 */
export async function updateNote(
  actor: SessionUser,
  projectId: number,
  versionId: number,
  reviewerId: number,
  note: string | null,
): Promise<ReviewerView[]> {
  const version = await loadVersion(versionId);
  await assertCanAssign(actor, projectId, version.authorId);
  const current = await prisma.reviewAssignment.findUnique({
    where: { versionId_reviewerId: { versionId, reviewerId } },
    select: { note: true },
  });
  if (!current) throw notFound('This person is not assigned to this review');

  const clean = normalizeNote(note, (await resolveProjectSettingsById(projectId)).reviewRequest);
  if (clean !== current.note) {
    await prisma.reviewAssignment.update({
      where: { versionId_reviewerId: { versionId, reviewerId } },
      data: { note: clean, assignedById: actor.id },
    });
    if (reviewerId !== actor.id) await announce([reviewerId], projectId, version, 'note');
  }
  return afterWrite(actor, projectId, version, null);
}

/** The version as the write operations pass it between themselves. */
type LoadedVersion = Awaited<ReturnType<typeof loadVersion>>;

/**
 * What every write does next: record the audit trail, wake the screens open on the version, inform
 * integrations, and return an up-to-date list.
 *
 * `userIds` is recorded only when the list itself changed: a rewritten instruction does not change who
 * is expected, and letting the audit log believe otherwise would be wrong.
 */
async function afterWrite(
  actor: SessionUser,
  projectId: number,
  version: LoadedVersion,
  userIds: number[] | null,
): Promise<ReviewerView[]> {
  const reviewers = await listReviewers(version.id);
  logAudit({
    userId: actor.id,
    action: userIds ? 'version.reviewers' : 'version.reviewer_note',
    entityType: 'Version',
    entityId: version.id,
    ...(userIds ? { metadata: { userIds } } : {}),
  });
  emitToProject(projectId, 'version:update', {
    projectId,
    id: version.id,
    taskId: version.taskId,
    assetId: version.assetId,
  });
  publishApiEvent('version.reviewers_changed', {
    projectId,
    entityType: 'version',
    entityId: version.id,
    actorId: actor.id,
    payload: {
      versionId: version.id,
      reviewers: reviewers.map((person) => ({ userId: person.id, note: person.note })),
    },
  });
  return reviewers;
}

/**
 * Notifies the people concerned, and subscribes the newcomers to the version.
 *
 * The assignment notification alone would have left the reviewer in the dark until they thought to reopen
 * the screen: the feedback and the decision that follow are exactly what they are waiting for. Follow-up
 * (32.G) delivers them, and the subscription stays theirs: removing them from the list does not unsubscribe
 * them, since they may have subscribed themselves in the meantime. A rewritten instruction does not
 * resubscribe anyone: the decision to stop following belongs to them.
 *
 * The reference points to the version's first media: this is what keeps the notification navigable
 * to the review screen (same choice as for the decision).
 */
async function announce(
  userIds: number[],
  projectId: number,
  version: LoadedVersion,
  kind: 'assigned' | 'note',
): Promise<void> {
  const firstMedia = await prisma.mediaObject.findFirst({
    where: { versionId: version.id, deletedAt: null },
    orderBy: { id: 'asc' },
    select: { id: true },
  });
  await Promise.all(
    userIds.map(async (userId) => {
      if (kind === 'assigned') await setWatch(userId, WatchTargetType.VERSION, version.id, true);
      await notify({
        userId,
        kind: 'reviewAssigned',
        messageKey: kind === 'assigned' ? 'notification.reviewAssigned' : 'notification.reviewNoteUpdated',
        params: { version: version.name },
        projectId,
        referenceId: firstMedia?.id ?? null,
      });
    }),
  );
}
