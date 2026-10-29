// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Role, TaskStatus } from './api';
/** ShotGrid integration types (Phase 48) — mirror of the views returned by the API. */

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
  /** Pipeline steps kept for this project, by ShotGrid identifier. */
  steps: { asset: number[]; shot: number[] };
  /** Statuses kept for this project, by scope and by ShotGrid code; empty = all. */
  visibleStatuses: Record<StatusScope, string[]>;
  eventMode: 'webhook' | 'polling' | 'manual';
  pollingIntervalSec: number;
  reconcile: { enabled: boolean; hour: number; lookbackHours: number; onBoot: boolean };
  media: {
    source: 'transcoded' | 'original';
    autoImport: boolean;
    statusFilter: string[];
    maxSizeMo: number | null;
    /** `sgCode`: the media carries the ShotGrid Version code. `filename`: its file name. */
    naming: 'sgCode' | 'filename';
    /** Bring back the thumbnail the site holds for a sequence, a shot or an asset. */
    thumbnails: boolean;
  };
  push: { publishMode: 'link' | 'upload' | 'off'; attributeToUser: boolean; attachAnnotations: boolean };
  /**
   * Who writes the description of a sequence, a shot or an asset.
   *
   * `shotgrid` (the default): the site is authoritative, and the field is **read-only** in ReView —
   * editing it there would create a divergence that the next sync would silently overwrite.
   * `writeBack` opens the round trip.
   */
  descriptions: { source: 'shotgrid' | 'review'; writeBack: boolean };
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
  /** Domains for which writes to the site were refused by the rights matrix. */
  pushBlocked: Record<string, { count: number; at: string }>;
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

/**
 * The four scopes that carry a pipeline status.
 *
 * ShotGrid keeps one list per entity (`sg_status_list` on Task, Shot, Sequence and Asset), and they
 * do not coincide: four values on a sequence, fifteen on a shot. Mixing them up offered the screen
 * states the site refuses on write — and the asset borrowed the task vocabulary for lack of its own.
 */
export type StatusScope = 'task' | 'shot' | 'sequence' | 'asset';

export interface PipelineStatus {
  id: number;
  scope: StatusScope;
  code: string;
  name: string;
  color: string;
  order: number;
  isDone: boolean;
  isDefault: boolean;
  /** The enum value this status represents — it is what carries the family. */
  legacyStatus: TaskStatus | null;
}

/** What ReView already knows about a ShotGrid crew member. */
export type SgCrewState = 'member' | 'account' | 'none' | 'ineligible';

export interface SgCrewPerson {
  sgId: number;
  name: string;
  login: string | null;
  email: string | null;
  sgStatus: string | null;
  state: SgCrewState;
  userId: number | null;
  /** True when the match comes from a link set by hand, not from the address. */
  linkedByHand: boolean;
  projectRole: Role | null;
  userRole: Role | null;
  /** Department as the site names it, even without a local match (lot 10). */
  sgDepartment: string | null;
  /** Matching ReView department, when the studio already has one under this name. */
  department: { id: number; name: string } | null;
}

export interface SgCrewResponse {
  crew: SgCrewPerson[];
  /** False for a project supervisor: they can add people, not create accounts. */
  canCreateAccounts: boolean;
  /** Without a configured email relay, no invitation will be sent. */
  smtpReady: boolean;
}

export interface SgCrewInviteResult {
  sgId: number;
  outcome: 'created' | 'added' | 'linked' | 'skipped';
  reason?: string;
}
