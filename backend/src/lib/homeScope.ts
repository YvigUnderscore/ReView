// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { MediaStatus, Prisma, Role } from '@prisma/client';
import { TASK_BLOCKED_FILTER, TASK_OPEN_FILTER } from './statusFamily';

/**
 * Scopes of "what awaits me": the single definition of each of the four counters of the Home page.
 *
 * The four cards each lied in their own way: "my retakes" was bounded by no scope (a project in the trash, a
 * hidden shot, a project I am not a member of still counted), "awaiting review" was labelled as personal but
 * computed for the whole studio, and "media in review" counted ALL published media, decided ones included — a
 * project delivered two years ago was among them.
 *
 * The fix is not to correct four queries: it is to write each scope only once. The card's counter and the page
 * it opens read the same `where` here, so a figure can no longer announce anything other than what the page
 * shows. A scope described in two places ends up diverging, and a divergent scope is either a lie or a leak.
 */

export type SessionUser = { id: number; role: Role };

/** ADMIN and SUPERVISOR see the whole studio; the others see their projects. */
export const isGlobalRole = (role: Role): boolean => role === Role.ADMIN || role === Role.SUPERVISOR;

/** Accessible project: alive (trash excluded) and, unless a global role applies, one I am a member of. */
export const accessibleProjects = (user: SessionUser): Prisma.ProjectWhereInput =>
  isGlobalRole(user.role)
    ? { deletedAt: null }
    : { deletedAt: null, memberships: { some: { userId: user.id } } };

/**
 * Version attached to an accessible project, through the three attachment paths.
 * A hidden (`hiddenAt`) or trashed parent is excluded: what is displayed nowhere must not weigh on a counter.
 */
export const versionInProjects = (access: Prisma.ProjectWhereInput): Prisma.VersionWhereInput => ({
  OR: [
    { task: { shot: { deletedAt: null, hiddenAt: null, project: access } } },
    { task: { asset: { deletedAt: null, hiddenAt: null, project: access } } },
    { asset: { deletedAt: null, hiddenAt: null, project: access } },
  ],
});

/** Task attached to an accessible project (both attachment paths). */
export const taskInProjects = (access: Prisma.ProjectWhereInput): Prisma.TaskWhereInput => ({
  OR: [
    { shot: { deletedAt: null, hiddenAt: null, project: access } },
    { asset: { deletedAt: null, hiddenAt: null, project: access } },
  ],
});

/**
 * Published, ready media within my scope. `version` receives the caller's extra constraint (no decision,
 * review assigned...): it merges into the same clause, because two `version` keys in a Prisma object would
 * overwrite each other.
 */
export function publishedMediaInScope(
  user: SessionUser,
  version: Prisma.VersionWhereInput = {},
): Prisma.MediaObjectWhereInput {
  return {
    deletedAt: null,
    published: true,
    status: MediaStatus.READY,
    version: { deletedAt: null, ...version, ...versionInProjects(accessibleProjects(user)) },
  };
}

/**
 * "Media in review": published media whose version **has not yet received a decision**.
 *
 * This is the substantive fix of this card. It used to count everything published: the label said "in review",
 * the figure said "in the database". An approved or rejected version is no longer in review — it belongs in
 * the history, not in a waiting counter.
 */
export const mediaInReviewWhere = (user: SessionUser): Prisma.MediaObjectWhereInput =>
  publishedMediaInScope(user, { reviewStatusId: null });

/**
/**
 * "Awaiting my review": what is expected of ME, via `ReviewAssignment`.
 *
 * The card sits among my figures and is labelled in the first person; yet it counted tasks awaiting a verdict
 * from the whole studio (`TASK_REVIEW_FILTER`). The collective volume still exists, but it has its own card and
 * its own label: never the same figure for two meanings.
 *
 * The filter applies to the version — it is the delivery that is handed over — and a decision already made drops
 * out of the count: nothing is awaited from me on a decided version. Same scope as
 * `/reviews?assigned=me&decision=none`, the view the card opens.
 */
export const awaitingMyReviewWhere = (user: SessionUser): Prisma.MediaObjectWhereInput =>
  publishedMediaInScope(user, { reviewStatusId: null, reviewers: { some: { reviewerId: user.id } } });

/**
/**
 * "My retakes": my tasks in retake or rejected, within my scope.
 *
 * The original counter only carried `assigneeId`: a task of a project put in the trash, of a hidden shot or of a
 * project I am no longer a member of kept claiming an action that no screen could show any more.
 */
export const myRetakesWhere = (user: SessionUser): Prisma.TaskWhereInput => ({
  assigneeId: user.id,
  AND: [taskInProjects(accessibleProjects(user)), TASK_BLOCKED_FILTER],
});

/** My live tasks (neither done nor out of play) within my scope. */
export const myOpenTasksWhere = (user: SessionUser): Prisma.TaskWhereInput => ({
  assigneeId: user.id,
  AND: [taskInProjects(accessibleProjects(user)), TASK_OPEN_FILTER],
});

/**
 * Task attached to ONE specific project, through its two attachment paths.
 *
 * A restriction, never a widening: it composes with `AND` with the scope above for the "my tasks" block of a
 * project page, which shows what the cross-project page already shows — the same scope, seen through a single
 * project's hole.
 */
export const taskOfProject = (projectId: number): Prisma.TaskWhereInput => ({
  OR: [{ shot: { projectId } }, { asset: { projectId } }],
});

/**
 * Comments readable from my Home page: those of the published media within my scope.
 * A CLIENT only sees the notes intended for them — same rule as the review thread, public sharing, search and export.
 */
export const commentFeedWhere = (user: SessionUser): Prisma.CommentWhereInput => ({
  media: publishedMediaInScope(user),
  ...(user.role === Role.CLIENT ? { isVisibleToClient: true } : {}),
});
