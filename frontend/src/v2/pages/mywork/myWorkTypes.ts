// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { MediaKind, TaskStatus, TaskType } from '../../types/api';

/**
 * Responses of the two cross-cutting views of "what awaits me":
 * `GET /api/dashboard/tasks` and `GET /api/dashboard/comments`.
 *
 * They unfold the home page counters, and read on the server exactly the scope of those
 * (`lib/homeScope`): the page shows as many rows as the card announces.
 */

/** One of my tasks, with its project: the page is cross-cutting, so the project is part of the location. */
export interface MyTaskItem {
  id: number;
  name: string;
  type: TaskType;
  status: TaskStatus;
  location: string;
  projectId: number | null;
  projectName: string | null;
  dueDate: string | null;
}

/** A note from the comment feed: enough to read it and open the commented media. */
export interface CommentFeedItem {
  id: number;
  mediaId: number;
  mediaKind: MediaKind;
  mediaName: string;
  location: string;
  versionName: string;
  content: string;
  timestamp: number | null;
  createdAt: string;
  author: string | null;
}
