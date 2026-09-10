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
 * Ce que l'écran « Mises à jour & sauvegardes » a besoin de savoir, en une réponse.
 *
 * Une seule route plutôt que quatre : l'écran ne sait rien montrer d'utile tant qu'il
 * ignore *à la fois* la version en service, ce qui est paru depuis, et ce que l'instance
 * est capable de faire elle-même. Trois requêtes qui arrivent dans le désordre donnent
 * trois états transitoires faux — « à jour » avant d'avoir demandé, notamment.
 */

/** Comment cette instance change de version. */
export type UpdateMode = 'registry' | 'build';

export interface OpsOverview {
  current: {
    version: string;
    commit: string | null;
    builtAt: string | null;
    node: string;
    /** Adresse des sources — obligation AGPL §13, et repère de diagnostic. */
    source: string;
  };
  /**
   * `registry` : les images publiées sont récupérées (`REVIEW_IMAGE_PREFIX` est posé).
   * `build` : la pile se construit sur le serveur du studio. Ce n'est pas un détail
   * d'exploitation — c'est ce qui décide si une mise à jour dure deux minutes ou une heure.
   */
  mode: UpdateMode;
  latest: ReleaseInfo | null;
  /** Tout ce qui est paru depuis la version en service : ce que la mise à jour apporterait. */
  newer: ReleaseInfo[];
  release: { checkedAt: string | null; error: ReleaseError | null };
  updateAvailable: boolean;
  backups: BackupCatalog;
  /** L'instance sait-elle agir sur elle-même, et jusqu'où ? */
  mechanism: Mechanism;
  /** L'opération en cours, s'il y en a une : c'est elle qui tient l'écran. */
  activeRun: RunSummary | null;
  recentRuns: RunSummary[];
  /** Les commandes exactes, pour l'exploitant qui préfère — ou doit — passer par un terminal. */
  commands: { update: string | null; backup: string; enableAgent: string };
}

/** Le mode se lit dans l'environnement, comme `scripts/update.sh` le lit dans `.env`. */
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
