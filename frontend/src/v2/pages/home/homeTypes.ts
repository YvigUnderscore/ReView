// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { MediaKind, TaskStatus, TaskType } from '../../types/api';

/** Réponse de GET /api/dashboard (12.B) — shapes display-ready construites côté serveur. */

export interface DashboardReview {
  mediaId: number;
  kind: MediaKind;
  name: string;
  thumbnailUrl: string | null;
  location: string;
  versionName: string;
  /** Nombre total de commentaires du média (badge de la carte). */
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
  /** Échéance (43.C) — null si non planifiée. */
  dueDate: string | null;
}

/** Projet récent avec progression (tâches approuvées / total). */
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
    publishedMedia: number;
    comments: number;
    /** Tendances 7 jours et compteurs personnels (refonte Accueil). */
    publishedMedia7d: number;
    comments7d: number;
    myRetakes: number;
    pendingReview: number;
  };
}
