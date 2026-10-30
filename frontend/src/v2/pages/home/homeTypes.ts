// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { MediaKind, TaskStatus, TaskType } from '../../types/api';

/** Response of GET /api/dashboard (12.B), with display-ready shapes built on the server. */

export interface DashboardReview {
  mediaId: number;
  kind: MediaKind;
  name: string;
  thumbnailUrl: string | null;
  location: string;
  versionName: string;
  /** Total number of comments on the media (badge of the card). */
  commentCount: number;
  lastComment: {
    content: string;
    author: string | null;
    timestamp: number | null;
    createdAt: string;
  };
}

export interface DashboardActivityItem {
  type: 'version' | 'media';
  at: string;
  label: string;
  location: string;
  author: string | null;
  taskId: number | null;
  mediaId: number | null;
}

export interface DashboardTask {
  id: number;
  name: string;
  type: TaskType;
  status: TaskStatus;
  location: string;
  projectId: number | null;
  /** Due date (43.C), null if not scheduled. */
  dueDate: string | null;
}

/** Recent project with its progress (approved tasks / total). */
export interface DashboardProject {
  id: number;
  name: string;
  thumbnailUrl: string | null;
  totalTasks: number;
  approvedTasks: number;
}

export interface DashboardData {
  latestReviews: DashboardReview[];
  activity: DashboardActivityItem[];
  myTasks: DashboardTask[];
  recentProjects: DashboardProject[];
  stats: {
    projects: number;
    /**
     * Media actually in review: published, ready, **without a decision given**. The card used to
     * count everything published, so a project delivered two years ago still appeared.
     */
    mediaInReview: number;
    comments: number;
    /** Seven-day trends, on the scope of the counter they accompany. */
    mediaInReview7d: number;
    comments7d: number;
    myRetakes: number;
    /**
     * What is expected of ME: the reviews entrusted to me that no decision has yet settled. The
     * former `pendingReview` carried the same personal label but counted the verdicts expected
     * from the whole studio.
     */
    awaitingMyReview: number;
  };
}
