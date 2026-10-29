// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { logger } from '../../lib/logger';
import { badRequest, forbidden } from '../../lib/errors';
import type { ShotgridClient } from './ShotgridClient';
import { belongsToProject, type ProjectScope } from './shotgridProjectGuard';
import { writeAllowedOn } from './shotgridTemplateGuard';
import { asEntityRef, type SgRecord } from './shotgridMapper';

/**
 * The only path through which ReView writes to ShotGrid.
 *
 * The partitioning checks already existed — re-reading the target, `belongsToProject`, refusal of template projects — but they relied on the **memory of whoever wrote the code**:
 * nothing prevented a new call from talking to the client directly. The proof that it slips is in the history: `ShotgridPlaylistSync` had copied the three checks by hand instead
 * of reusing `resolveTarget`, and two copies of one rule always end up diverging.
 *
 * This module turns the discipline into a constraint. The client's raw methods are prefixed `unsafe` and are no longer called anywhere else — `ShotgridWriteGuard.test.ts`
 * makes the suite fail if one of them reappears outside here. Writing into the wrong project becomes what it should always have been: an error one cannot commit by distraction.
 *
 * **What this guard does not cover**, and no code will:
 *
 *  - *The window between the re-read and the write.* ShotGrid's REST API offers no conditional write: between the moment one checks an entity's project and the moment one
 *    writes it, nothing formally guarantees it has not moved. A few milliseconds, and a re-read that makes the case negligible — but not nil.
 *  - *A connection pointed at the wrong project from the start.* All writes then go to the "right" place of a false premise. It is `createConnection`
 *    (identifier **and** name checked against each other) and `openConnection` (name rechecked before each pass) that hold this end.
 */

export interface WriterScope extends ProjectScope {
  client: ShotgridClient;
}

/** Fields re-read to decide: the identity, the project, and the project name for the template. */
const GUARD_FIELDS = ['id', 'project'];

export class ShotgridWriter {
  constructor(private readonly scope: WriterScope) {}

  private get projectScope(): ProjectScope {
    return { sgProjectId: this.scope.sgProjectId, sgProjectName: this.scope.sgProjectName };
  }

    /**
     * Is the target writable? Re-read, segregation, template.
     *
     * Returns `false` rather than throwing: a refused write is logged and the synchronization carries on. This is the behaviour that `resolveTarget` and the guard copied
     * into the playlists already had.
     */
  private async targetWritable(sgType: string, sgId: number): Promise<boolean> {
    const remote = await this.scope.client.findById(sgType, sgId, GUARD_FIELDS);
    if (!remote) {
      logger.warn({ sgType, sgId }, 'Écriture ShotGrid abandonnée : cible introuvable sur le site');
      return false;
    }
    const verdict = belongsToProject(remote, this.projectScope);
    if (!verdict.ok) {
      logger.error(
        { sgType, sgId, expected: this.scope.sgProjectId, found: verdict.foundProjectId },
        'Écriture ShotGrid annulée : la cible appartient à un autre projet',
      );
      return false;
    }
    if (!writeAllowedOn(remote)) {
      logger.error({ sgType, sgId }, 'Écriture ShotGrid annulée : cible dans un projet modèle');
      return false;
    }
    return true;
  }

    /**
     * Modifies an existing entity. `null` when the write was refused — the caller has nothing more to do, the refusal is already logged.
     */
  async update(
    sgType: string,
    sgId: number,
    data: Record<string, unknown>,
    options: { asUserLogin?: string | null } = {},
  ): Promise<SgRecord | null> {
    if (!(await this.targetWritable(sgType, sgId))) return null;
    return this.scope.client.unsafeUpdate(sgType, sgId, data, options);
  }

    /**
     * Creates an entity **in the linked project**.
     *
     * The `project` is set here and nowhere else: a caller can neither forget it nor target another one. A payload carrying a different one is a programming error,
     * not data to arbitrate — we throw.
     *
     * The re-read that follows is not superstition: it is the site that decides what it actually wrote, and an entity deposited in someone else's production cannot be undone by itself.
     */
  async create(
    sgType: string,
    data: Record<string, unknown>,
    options: { asUserLogin?: string | null } = {},
  ): Promise<SgRecord> {
    const asked = asEntityRef(data.project);
    if (asked && asked.id !== this.scope.sgProjectId) {
      logger.error(
        { sgType, asked: asked.id, expected: this.scope.sgProjectId },
        'Création ShotGrid refusée : la charge utile vise un autre projet',
      );
      throw badRequest('ShotGrid payload targets another project');
    }

    const created = await this.scope.client.unsafeCreate(
      sgType,
      { ...data, project: { type: 'Project', id: this.scope.sgProjectId } },
      options.asUserLogin ?? null,
    );

    const check = await this.scope.client.findById(sgType, created.id, GUARD_FIELDS);
    if (check && !belongsToProject(check, this.projectScope).ok) {
      logger.error(
        { sgType, sgId: created.id, expected: this.scope.sgProjectId },
        'Entité créée hors du projet lié — à retirer du site',
      );
      throw badRequest('ShotGrid filed the entity outside the target project');
    }
    if (check && !writeAllowedOn(check)) {
      throw forbidden('ShotGrid template project — writing is refused');
    }
    return created;
  }

    /** Deposits a file on an entity — same re-read as `update`. */
  async upload(
    sgType: string,
    sgId: number,
    field: string,
    body: Buffer,
    filename: string,
    contentType: string,
  ): Promise<boolean> {
    if (!(await this.targetWritable(sgType, sgId))) return false;
    await this.scope.client.unsafeUploadFile(sgType, sgId, field, body, filename, contentType);
    return true;
  }
}

/** A connection's writer — the only way to obtain one. */
export function writerFor(scope: WriterScope): ShotgridWriter {
  return new ShotgridWriter(scope);
}
