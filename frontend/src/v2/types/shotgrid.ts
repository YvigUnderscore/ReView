// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/** Types de l'intégration ShotGrid (Phase 48) — miroir des vues renvoyées par l'API. */

export type SgAuthMode = 'script' | 'user';

export interface SgSite {
  id: number;
  name: string;
  baseUrl: string;
  authMode: SgAuthMode;
  scriptName: string | null;
  login: string | null;
  hasCredentials: boolean;
  connectionCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface SgAccess {
  read: boolean;
  write: boolean;
}

export type SgDomain = 'hierarchy' | 'tasks' | 'statuses' | 'versions' | 'notes' | 'playlists' | 'users';

export interface SgSettings {
  domains: Record<SgDomain, SgAccess>;
  lockLocalCreation: boolean;
  eventMode: 'webhook' | 'polling' | 'manual';
  pollingIntervalSec: number;
  reconcile: { enabled: boolean; hour: number; lookbackHours: number; onBoot: boolean };
  media: {
    source: 'transcoded' | 'original';
    autoImport: boolean;
    statusFilter: string[];
    maxSizeMo: number | null;
  };
  push: { publishMode: 'link' | 'upload' | 'off'; attributeToUser: boolean; attachAnnotations: boolean };
  versionStatusMap: Record<string, number>;
  conflictPolicy: 'sg_wins' | 'review_wins' | 'manual';
}

export type SgConnectionStatus = 'ok' | 'auth_error' | 'project_mismatch' | 'disabled' | 'syncing' | 'error';

export interface SgConnection {
  id: number;
  projectId: number;
  site: SgSite;
  sgProjectId: number;
  sgProjectName: string;
  sgProjectUrl: string;
  active: boolean;
  status: SgConnectionStatus;
  statusMessage: string | null;
  settings: SgSettings;
  lastSyncAt: string | null;
  lastEventAt: string | null;
  webhookUrl: string;
  hasWebhookSecret: boolean;
  createdAt: string;
}

export interface SgRemoteProject {
  id: number;
  name: string;
  status: string | null;
  archived: boolean;
}

export interface SgSyncRun {
  id: number;
  kind: string;
  status: 'running' | 'ok' | 'partial' | 'error' | 'cancelled';
  startedAt: string;
  finishedAt: string | null;
  stats: Record<
    string,
    { created: number; updated: number; unchanged: number; skipped: number; failed: number }
  >;
  triggeredBy: { id: number; name: string | null; email: string } | null;
  _count: { logs: number };
}

export interface SgSyncLog {
  id: number;
  level: 'info' | 'warn' | 'error' | 'conflict';
  messageKey: string;
  vars: Record<string, unknown>;
  sgType: string | null;
  sgId: number | null;
  localType: string | null;
  localId: number | null;
  resolvedAt: string | null;
  resolution: string | null;
  createdAt: string;
}

export type SgDiffKind = 'missing_local' | 'missing_remote' | 'field_differs' | 'unlinked';

export interface SgDiffEntry {
  kind: SgDiffKind;
  entity: 'Sequence' | 'Shot' | 'Asset' | 'Task' | 'Version';
  name: string;
  sgId: number | null;
  localId: number | null;
  sgUrl: string | null;
  fields?: Array<{ field: string; review: string | null; shotgrid: string | null }>;
}

export interface SgDiffReport {
  generatedAt: string;
  sgProjectId: number;
  sgProjectName: string;
  projectNameOk: boolean;
  remoteProjectName: string | null;
  counts: Record<string, { review: number; shotgrid: number }>;
  entries: SgDiffEntry[];
  truncated: boolean;
}

export interface SgImportableVersion {
  sgId: number;
  code: string;
  status: string | null;
  description: string | null;
  entity: string | null;
  task: string | null;
  user: string | null;
  hasMedia: boolean;
  imported: boolean;
  updatedAt: string | null;
}

export interface PipelineStatus {
  id: number;
  scope: 'task' | 'shot';
  code: string;
  name: string;
  color: string;
  order: number;
  isDone: boolean;
  isDefault: boolean;
  legacyStatus: string | null;
}
