import { QueryClient } from '@tanstack/react-query';

/**
 * Client TanStack Query global (10.E1).
 * - staleTime 30 s : navigation retour instantanée depuis le cache, re-fetch en arrière-plan.
 * - retry 1 : une seule relance sur échec réseau (les erreurs métier 4xx restent immédiates).
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
 * Convention de clés — hiérarchiques pour des invalidations ciblées :
 * `invalidateQueries({ queryKey: qk.project(id) })` invalide aussi activity/settings/trash.
 */
export const qk = {
  setupStatus: ['setup-status'] as const,
  dashboard: ['dashboard'] as const,
  announcementsActive: ['announcements', 'active'] as const,
  reviews: (filter: string) => ['reviews', filter] as const,
  projects: ['projects'] as const,
  project: (id: number) => ['project', id] as const,
  projectActivity: (id: number) => ['project', id, 'activity'] as const,
  projectSettings: (id: number) => ['project', id, 'settings'] as const,
  projectTrash: (id: number) => ['project', id, 'trash'] as const,
  projectMedia: (id: number, kind?: string) => ['project', id, 'media', kind ?? 'all'] as const,
  sequences: (projectId: number) => ['sequences', projectId] as const,
  sequence: (id: number) => ['sequence', id] as const,
  shots: (projectId: number) => ['shots', projectId] as const,
  shotsOfSequence: (projectId: number, sequenceId: number | 'none') =>
    ['shots', projectId, sequenceId] as const,
  shot: (id: number) => ['shot', id] as const,
  assets: (projectId: number) => ['assets', projectId] as const,
  asset: (id: number) => ['asset', id] as const,
  tasks: (shotId: number) => ['tasks', shotId] as const,
  task: (id: number) => ['task', id] as const,
  /** parent = `taskId=1` ou `assetId=2` (query-string du GET /api/versions) */
  versions: (parent: string) => ['versions', parent] as const,
  version: (id: number) => ['version', id] as const,
  media: (id: number) => ['media', id] as const,
  drafts: ['drafts'] as const,
  notifications: ['notifications'] as const,
  comments: (mediaId: number) => ['comments', mediaId] as const,
  context: (entity: string, id: number) => ['context', entity, id] as const,
  search: (q: string) => ['search', q] as const,
  users: ['users'] as const,
  preferences: ['preferences'] as const,
  documents: (projectId: number | null) => ['documents', projectId ?? 'all'] as const,
  document: (id: number) => ['document', id] as const,
  admin: (section: string) => ['admin', section] as const,
  board: (scope: string, id: number) => ['board', scope, id] as const,
  hdris: ['hdris'] as const,
  docsManifest: () => ['docs', 'manifest'] as const,
  docsPage: (path: string) => ['docs', 'page', path] as const,
  reviewStatuses: ['review-statuses'] as const,
  watches: ['watches'] as const,
  playlists: (projectId: number) => ['playlists', projectId] as const,
  playlist: (id: number) => ['playlist', id] as const,
  liveSessions: (projectId: number) => ['live-sessions', projectId] as const,
  timelineMarkers: (mediaId: number) => ['timeline-markers', mediaId] as const,
  versionDecisions: (versionId: number) => ['version-decisions', versionId] as const,
} as const;
