// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { parseSettings, sgCreateLink } from './shotgridSettings';

/**
 * Local creation lock.
 *
 * When a project is driven from ShotGrid, creating a shot on the ReView side produces an orphan entity: it does not exist in the production registry, nobody
 * will see it in the reports, and the next synchronization will not know what to do with it. Rather than let it be born only to flag it later as a gap, we refuse
 * the creation and point to the matching ShotGrid form, pre-filled on the right project.
 *
 * The lock is lifted in the project settings: some studios prefer to create from ReView (the mirror creation then writes to ShotGrid first).
 */

export type CreatableKind = 'sequence' | 'shot' | 'asset';

const SG_ENTITY: Record<CreatableKind, string> = {
  sequence: 'Sequence',
  shot: 'Shot',
  asset: 'Asset',
};

/** Error carrying the remote creation link: the client turns it into a button. */
export class ShotgridLockedError extends AppError {
  constructor(
    message: string,
    readonly sgCreateUrl: string,
    readonly sgProjectName: string,
  ) {
    super(message, 409, 'SHOTGRID_LOCKED', { sgCreateUrl, sgProjectName });
    this.name = 'ShotgridLockedError';
  }
}

export interface LockState {
  locked: boolean;
  sgCreateUrl?: string;
  sgProjectName?: string;
}

export async function creationLockState(projectId: number, kind: CreatableKind): Promise<LockState> {
  const conn = await prisma.shotgridConnection.findUnique({
    where: { projectId },
    include: { site: true },
  });
  if (!conn?.active) return { locked: false };
  const settings = parseSettings(conn.settings);
  if (!settings.lockLocalCreation) return { locked: false };
  return {
    locked: true,
    sgCreateUrl: sgCreateLink(conn.site.baseUrl, SG_ENTITY[kind], conn.sgProjectId),
    sgProjectName: conn.sgProjectName,
  };
}

/**
 * Refuses creation if the project is driven from ShotGrid.
 * Called by the creation routes of sequences, shots and assets.
 */
export async function assertLocalCreationAllowed(projectId: number, kind: CreatableKind): Promise<void> {
  const state = await creationLockState(projectId, kind);
  if (!state.locked) return;
  throw new ShotgridLockedError(
    `This project is driven from ShotGrid ("${state.sgProjectName}") — create the item in ShotGrid, it will come back with the next sync`,
    state.sgCreateUrl!,
    state.sgProjectName!,
  );
}

/**
 * Is this project's description editable in ReView?
 *
 * No, by default, as soon as the project is linked: the description comes from the site, and editing it here would produce a divergence that the next
 * synchronization would overwrite without saying so. The studio opens editing by choosing `descriptions.source = 'review'`, or by enabling the push back to
 * the site (`writeBack`): it is then a deliberate round trip.
 */
export interface DescriptionPolicy {
  editable: boolean;
  /** Where to edit it when it is locked: the direct link to the site's record. */
  sgProjectName?: string;
  /** `true` when a local change is pushed back to the site. */
  writeBack: boolean;
}

export async function descriptionPolicy(projectId: number): Promise<DescriptionPolicy> {
  const conn = await prisma.shotgridConnection.findUnique({ where: { projectId } });
  if (!conn?.active) return { editable: true, writeBack: false };
  const settings = parseSettings(conn.settings);
  const { source, writeBack } = settings.descriptions;
  return {
    editable: source === 'review' || writeBack,
    sgProjectName: conn.sgProjectName,
    writeBack: writeBack && source === 'review',
  };
}

/** Refuses a description write when the site is authoritative. */
export async function assertDescriptionWritable(projectId: number): Promise<void> {
  const policy = await descriptionPolicy(projectId);
  if (policy.editable) return;
  throw new AppError(
    `The description is owned by ShotGrid ("${policy.sgProjectName}") — edit it there, or unlock editing in the project settings`,
    409,
    'SHOTGRID_DESCRIPTION_LOCKED',
    { sgProjectName: policy.sgProjectName },
  );
}
