// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { getSourceUrl } from '../lib/settings';
import { appVersion, compareSemver } from '../lib/version';
import * as BackupCatalogService from './BackupCatalogService';
import type { BackupCatalog } from './BackupCatalogService';
import * as OpsSpoolService from './OpsSpoolService';
import type { Mechanism, RunSummary } from './OpsSpoolService';
import * as ReleaseService from './ReleaseService';
import type { ReleaseError, ReleaseInfo } from './ReleaseService';

/**
 * What the "Updates & backups" screen needs to know, in one response.
 *
 * A single route rather than four: the screen cannot usefully show anything while it ignores *at the same
 * time* the version in service, what has been released since, and what the instance
 * is capable of doing itself. Three requests arriving out of order give three false transitional states — "up
 * to date" before having asked, in particular.
 */

/** How this instance changes version. */
export type UpdateMode = 'registry' | 'build';

export interface OpsOverview {
  current: {
    version: string;
    commit: string | null;
    builtAt: string | null;
    node: string;
    /** Address of the sources — AGPL §13 obligation, and a diagnostic marker. */
    source: string;
  };
  /**
   * `registry`: the published images are fetched (`REVIEW_IMAGE_PREFIX` is set).
   * `build`: the stack is built on the studio's server. This is not an operational detail — it is what
   * decides whether an update takes two minutes or an hour.
   */
  mode: UpdateMode;
  latest: ReleaseInfo | null;
  /** Everything released since the running version: what the update would bring. */
  newer: ReleaseInfo[];
  release: { checkedAt: string | null; error: ReleaseError | null };
  updateAvailable: boolean;
  backups: BackupCatalog;
  /** Can the instance act on itself, and to what extent? */
  mechanism: Mechanism;
  /** The operation in progress, if any: it is that which holds the screen. */
  activeRun: RunSummary | null;
  recentRuns: RunSummary[];
  /** The exact commands, for the operator who prefers — or must — go through a terminal. */
  commands: { update: string | null; backup: string; enableAgent: string };
}

/** The mode is read from the environment, as `scripts/update.sh` reads it from `.env`. */
export function updateMode(environment: NodeJS.ProcessEnv = process.env): UpdateMode {
  return environment.REVIEW_IMAGE_PREFIX?.trim() ? 'registry' : 'build';
}

export async function overview(): Promise<OpsOverview> {
  const [{ releases, checkedAt, error }, backups, source, mechanism, recentRuns] = await Promise.all([
    ReleaseService.catalog(),
    BackupCatalogService.list(),
    getSourceUrl(),
    OpsSpoolService.mechanism(),
    OpsSpoolService.listRuns(10),
  ]);

  const latest = ReleaseService.latestOf(releases);
  const newer = ReleaseService.newerThan(releases, appVersion.version);

  return {
    current: {
      version: appVersion.version,
      commit: appVersion.commit,
      builtAt: appVersion.builtAt,
      node: process.version,
      source,
    },
    mode: updateMode(),
    latest,
    newer,
    release: { checkedAt, error },
    updateAvailable: latest !== null && compareSemver(latest.tag, appVersion.version) > 0,
    backups,
    mechanism,
    activeRun: recentRuns.find((r) => r.state === 'queued' || r.state === 'running') ?? null,
    recentRuns,
    commands: {
      update: latest ? `bash scripts/update.sh --version ${latest.tag}` : null,
      backup: 'bash scripts/backup.sh',
      enableAgent: 'bash scripts/ops-agent.sh install',
    },
  };
}
