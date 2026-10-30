// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { MediaStatus, Prisma, Role } from '@prisma/client';
import { TASK_BLOCKED_FILTER, TASK_OPEN_FILTER } from './statusFamily';
import {
  accessibleProjects,
  awaitingMyReviewWhere,
  commentFeedWhere,
  mediaInReviewWhere,
  myOpenTasksWhere,
  myRetakesWhere,
} from './homeScope';

/**
 * The four Home counters, on their scope.
 *
 * Each lied in its own way, and none of these lies showed in a figure: one had to know the database to realise
 * that "my retakes" counted a project in the trash, or that "awaiting review" — placed among my figures — counted
 * the whole studio. So it is the `where` clauses themselves that are checked, not the returned value: that is
 * where the truth lies, and a value test would pass on an empty database.
 */

const artist = { id: 3, role: Role.ARTIST };
const admin = { id: 1, role: Role.ADMIN };
const client = { id: 8, role: Role.CLIENT };

/** An ARTIST's accessible project: alive and one they are a member of. */
const mine = { deletedAt: null, memberships: { some: { userId: 3 } } };

/** The three attachment paths of a version, hidden parents excluded. */
const versionPaths = [
  { task: { shot: { deletedAt: null, hiddenAt: null, project: mine } } },
  { task: { asset: { deletedAt: null, hiddenAt: null, project: mine } } },
  { asset: { deletedAt: null, hiddenAt: null, project: mine } },
];

describe('accessibleProjects', () => {
  it('bounds an ARTIST to their live projects, and leaves the whole studio to an ADMIN', () => {
    expect(accessibleProjects(artist)).toEqual(mine);
    expect(accessibleProjects(admin)).toEqual({ deletedAt: null });
  });
});

describe('myRetakesWhere — "my retakes"', () => {
  it('bounds to my tasks, my projects, excluding the trash and hidden items', () => {
    // The original counter only carried `assigneeId`: a task of a project put in the trash, of a hidden shot or
    // of a project I am no longer a member of kept claiming an action no screen could show.
    const where = myRetakesWhere(artist);
    expect(where.assigneeId).toBe(3);
    const [scope, family] = where.AND as Prisma.TaskWhereInput[];
    expect(scope).toEqual({
      OR: [
        { shot: { deletedAt: null, hiddenAt: null, project: mine } },
        { asset: { deletedAt: null, hiddenAt: null, project: mine } },
      ],
    });
    // The "blocked" family is the rest of the server's, not a local copy: it is what reads the studio's
    // reference data (`PipelineStatus`), not the frozen enum.
    expect(family).toBe(TASK_BLOCKED_FILTER);
  });

  it('shares its scope with the list of my live tasks', () => {
    // The "my tasks" page and the counter must count the same thing: only the status family tells them apart.
    const [scope] = myOpenTasksWhere(artist).AND as Prisma.TaskWhereInput[];
    const [retakeScope, family] = myRetakesWhere(artist).AND as Prisma.TaskWhereInput[];
    expect(scope).toEqual(retakeScope);
    expect((myOpenTasksWhere(artist).AND as Prisma.TaskWhereInput[])[1]).toBe(TASK_OPEN_FILTER);
    expect(family).toBe(TASK_BLOCKED_FILTER);
  });
});

describe('awaitingMyReviewWhere — "what is expected of me"', () => {
  it('counts only the reviews entrusted to me, with no decision made', () => {
    // The card sits among my figures and is labelled in the first person; yet it counted verdicts expected from
    // the whole studio.
    const where = awaitingMyReviewWhere(artist);
    expect(where.deletedAt).toBeNull();
    expect(where.published).toBe(true);
    expect(where.status).toBe(MediaStatus.READY);
    const version = where.version as Prisma.VersionWhereInput;
    expect(version.reviewers).toEqual({ some: { reviewerId: 3 } });
    // A decision already made = nothing left to expect from me.
    expect(version.reviewStatusId).toBeNull();
    expect(version.deletedAt).toBeNull();
    expect(version.OR).toEqual(versionPaths);
  });
});

describe('mediaInReviewWhere — "media in review"', () => {
  it('excludes versions already decided, and bounds to the accessible scope', () => {
    // The counter took ALL published, ready media: a project delivered two years ago was still among them,
    // decisions included.
    const where = mediaInReviewWhere(artist);
    expect(where.published).toBe(true);
    expect(where.status).toBe(MediaStatus.READY);
    const version = where.version as Prisma.VersionWhereInput;
    expect(version.reviewStatusId).toBeNull();
    expect(version.OR).toEqual(versionPaths);
    // And nothing personal here: it is the volume of the scope, not my queue.
    expect(version.reviewers).toBeUndefined();
  });
});

describe('commentFeedWhere — the comment feed', () => {
  it('bounds a CLIENT to the notes intended for them, and no one else', () => {
    expect(commentFeedWhere(client).isVisibleToClient).toBe(true);
    expect(commentFeedWhere(artist).isVisibleToClient).toBeUndefined();
    const media = commentFeedWhere(artist).media as Prisma.MediaObjectWhereInput;
    expect(media.published).toBe(true);
    expect((media.version as Prisma.VersionWhereInput).OR).toEqual(versionPaths);
  });
});
