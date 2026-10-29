// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { QueryClient } from '@tanstack/react-query';

/**
 * Global TanStack Query client (10.E1).
 * - staleTime 30 s: instant back-navigation from the cache, background re-fetch.
 * - retry 1: a single retry on network failure (business 4xx errors stay immediate).
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

/**
 * Key convention — hierarchical for targeted invalidations:
 * `invalidateQueries({ queryKey: qk.project(id) })` also invalidates activity/settings/trash.
 */
export const qk = {
  setupStatus: ['setup-status'] as const,
  branding: ['branding'] as const,
  dashboard: ['dashboard'] as const,
  /** My tasks, across all projects ("my tasks" page) — key = filter string. */
  myTasks: (filter: string) => ['my-tasks', filter] as const,
  /** All views combined: what a changed status invalidates, wherever it comes from. */
  myTasksAll: ['my-tasks'] as const,
  /** Feed of the latest comments within my scope ("comments" card of the Home page). */
  commentFeed: (filter: string) => ['comment-feed', filter] as const,
  announcementsActive: ['announcements', 'active'] as const,
  /** Default layouts of the overview, one per role (studio setting). */
  overviewLayoutDefaults: ['overview-layout'] as const,
  reviews: (filter: string) => ['reviews', filter] as const,
  projects: ['projects'] as const,
  projectsArchived: ['projects', 'archived'] as const,
  project: (id: number) => ['project', id] as const,
  projectActivity: (id: number) => ['project', id, 'activity'] as const,
  projectSettings: (id: number) => ['project', id, 'settings'] as const,
  projectUsage: (id: number) => ['project', id, 'usage'] as const,
  projectTrash: (id: number) => ['project', id, 'trash'] as const,
  projectStats: (id: number) => ['project', id, 'stats'] as const,
  projectSchedule: (id: number) => ['project', id, 'schedule'] as const,
  /** Tracking grid (shots × departments). `search` is the filter query string:
   *  two different filters are two different lists, never the same page rewritten. */
  projectGrid: (id: number, search: string) => ['project', id, 'grid', search] as const,
  /** All the grids of the project — what a cell mutation invalidates, filters included. */
  projectGridAll: (id: number) => ['project', id, 'grid'] as const,
  projectMedia: (id: number, kind?: string) => ['project', id, 'media', kind ?? 'all'] as const,
  /** Episode level (optional per project) — the setting hangs under the project, like the other
   *  settings: invalidating it with them is enough. */
  episodeSettings: (projectId: number) => ['project', projectId, 'episodes', 'settings'] as const,
  episodes: (projectId: number) => ['episodes', projectId] as const,
  episode: (id: number) => ['episode', id] as const,
  sequences: (projectId: number) => ['sequences', projectId] as const,
  sequence: (id: number) => ['sequence', id] as const,
  shots: (projectId: number) => ['shots', projectId] as const,
  shotsOfSequence: (projectId: number, sequenceId: number | 'none') =>
    ['shots', projectId, sequenceId] as const,
  shot: (id: number) => ['shot', id] as const,
  assets: (projectId: number) => ['assets', projectId] as const,
  asset: (id: number) => ['asset', id] as const,
  assetTree: (id: number) => ['asset', id, 'tree'] as const,
  /** Permalink of an asset or a shot (C3): `/{assets|shots}/:id/latest`. */
  entityLatest: (entity: 'asset' | 'shot', id: number) => [entity, id, 'latest'] as const,
  tasks: (shotId: number) => ['tasks', shotId] as const,
  /** The shot seen as a folder: departments → tasks → versions. */
  shotTree: (shotId: number) => ['shot', shotId, 'tree'] as const,
  /** All the tasks of a project, whatever their parent (upload destination). */
  projectTasks: (projectId: number) => ['tasks', 'project', projectId] as const,
  /** The whole kanban in one request (C4) — replaces one request per shot and per asset. */
  projectBoard: (projectId: number) => ['tasks', 'board', projectId] as const,
  /** Departments applicable to a project (B1): its own, otherwise the studio's. */
  departments: (projectId: number) => ['departments', projectId] as const,
  task: (id: number) => ['task', id] as const,
  /** parent = `taskId=1` or `assetId=2` (query string of GET /api/versions) */
  versions: (parent: string) => ['versions', parent] as const,
  version: (id: number) => ['version', id] as const,
  media: (id: number) => ['media', id] as const,
  drafts: ['drafts'] as const,
  notifications: ['notifications'] as const,
  comments: (mediaId: number) => ['comments', mediaId] as const,
  context: (entity: string, id: number) => ['context', entity, id] as const,
  search: (q: string) => ['search', q] as const,
  users: ['users'] as const,
  userProfile: (id: number) => ['user-profile', id] as const,
  preferences: ['preferences'] as const,
  documents: (projectId: number | null) => ['documents', projectId ?? 'all'] as const,
  document: (id: number) => ['document', id] as const,
  admin: (section: string) => ['admin', section] as const,
  adminUser: (id: number) => ['admin', 'user', id] as const,
  adminProjects: ['admin', 'projects'] as const,
  adminProject: (id: number) => ['admin', 'project', id] as const,
  adminVersions: (filter: string) => ['admin', 'versions', filter] as const,
  adminComments: (filter: string) => ['admin', 'comments', filter] as const,
  adminStorage: ['admin', 'storage'] as const,
  adminOps: ['admin', 'ops'] as const,
  adminOpsRun: (id: string) => ['admin', 'ops', 'run', id] as const,
  board: (scope: string, id: number) => ['board', scope, id] as const,
  hdris: ['hdris'] as const,
  ocioConfigs: ['ocio', 'configs'] as const,
  ocioDisplays: (id: string) => ['ocio', 'displays', id] as const,
  changelog: ['changelog'] as const,
  docsManifest: () => ['docs', 'manifest'] as const,
  docsPage: (path: string) => ['docs', 'page', path] as const,
  reviewStatuses: ['review-statuses'] as const,
  watches: ['watches'] as const,
  /** Production management (C6), rhythm window included. */
  projectProduction: (projectId: number, weeks: number) => ['production', projectId, weeks] as const,
  /** All windows combined — to invalidate when a deadline moves. */
  projectProductionAll: (projectId: number) => ['production', projectId] as const,
  playlists: (projectId: number) => ['playlists', projectId] as const,
  playlist: (id: number) => ['playlist', id] as const,
  /** Catalogue of versions to put in a playlist (C5), key = filter string. */
  playlistCandidates: (projectId: number, filters: string) =>
    ['playlist-candidates', projectId, filters] as const,
  /** Automatic cuts (Phase 45) — `sequenceId` null = cut of the whole project. */
  timelineOf: (projectId: number, sequenceId: number | null) =>
    ['timeline', 'of', projectId, sequenceId ?? 'project'] as const,
  timeline: (id: number) => ['timeline', id] as const,
  timelineSnapshots: (id: number) => ['timeline', id, 'snapshots'] as const,
  timelineExport: (id: number) => ['timeline', id, 'export'] as const,
  timelineComments: (id: number) => ['timeline', id, 'comments'] as const,
  timelineSnapshot: (id: number, revision: number) => ['timeline', id, 'snapshots', revision] as const,
  liveSessions: (projectId: number) => ['live-sessions', projectId] as const,
  timelineMarkers: (mediaId: number) => ['timeline-markers', mediaId] as const,
  versionDecisions: (versionId: number) => ['version-decisions', versionId] as const,
  /** People to whom a version's review is assigned (Phase 49). */
  versionReviewers: (versionId: number) => ['version-reviewers', versionId] as const,
  shareLinks: (projectId: number) => ['share-links', projectId] as const,
  watermarkConfig: ['watermark-config'] as const,
  authSessions: ['auth-sessions'] as const,
  apiTokens: ['api-tokens'] as const,
} as const;
