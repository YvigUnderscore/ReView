import type { MediaKind, TaskStatus, TaskType } from '../../types/api';

/** Réponse de GET /api/dashboard (12.B) — shapes display-ready construites côté serveur. */

export interface DashboardReview {
  mediaId: number;
  kind: MediaKind;
  name: string;
  thumbnailUrl: string | null;
  location: string;
  versionName: string;
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
}

export interface DashboardData {
  latestReviews: DashboardReview[];
  activity: DashboardActivityItem[];
  myTasks: DashboardTask[];
  stats: { projects: number; publishedMedia: number; comments: number };
}
