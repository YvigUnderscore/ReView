// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { MessageKey } from '../i18n';
import type { PipelineStatus, StatusScope } from '../types/shotgrid';
import type { TaskStatus } from '../types/api';
import { TASK_STATUSES, TASK_STATUS_LABEL_KEY } from './taskStatus';

/**
 * Status choice of an entity — pure logic, no React and no network.
 *
 * Changing a status used to require opening the record and then a settings panel; the most frequent
 * gesture in production was the most expensive. It now goes through the context menu, wherever an
 * entity is visible. This module describes *which* choices exist and *which body* translates them —
 * rendering and the network call live elsewhere.
 */

/** "No status" sentinel: the radio group cannot carry an empty value. */
export const NO_STATUS = 'none';

/** Prefix of the fallback choices, when a project does not yet have a catalogue. */
export const LEGACY_PREFIX = 'legacy:';

export interface StatusChoice {
  value: string;
  /** Name of the status as the studio wrote it — data, never translated. */
  label: string;
  color: string | null;
  statusId: number | null;
  legacyStatus: TaskStatus | null;
}

export type { StatusScope };

/**
 * The choices offered for a given scope.
 *
 * Without a catalogue, a task falls back to the six historical values — which is what the kanban already
 * manipulates. A shot or a sequence, on the other hand, has no fallback: their `PATCH` only accepts
 * `pipelineStatusId`, and offering values it would refuse would give a menu that fails every time. The
 * menu then disappears, which is honest.
 */
export function statusChoices(
  statuses: PipelineStatus[],
  scope: StatusScope,
  t: (key: MessageKey) => string,
): StatusChoice[] {
  if (statuses.length > 0) {
    return statuses.map((status) => ({
      value: String(status.id),
      label: status.name,
      color: status.color,
      statusId: status.id,
      legacyStatus: status.legacyStatus,
    }));
  }
  if (scope !== 'task') return [];
  return TASK_STATUSES.map((status) => ({
    value: `${LEGACY_PREFIX}${status}`,
    label: t(TASK_STATUS_LABEL_KEY[status]),
    color: null,
    statusId: null,
    legacyStatus: status,
  }));
}

/**
 * The value ticked in the group.
 *
 * The family fallback matters: an entity may carry a status inherited from another site (or from a
 * project whose vocabulary changed) that is no longer offered here. Rather than showing no tick, we show
 * the choice of the same family — the user sees where they stand, instead of a menu claiming that no
 * status is set.
 */
export function currentStatusValue(
  choices: StatusChoice[],
  entity: { pipelineStatusId?: number | null; status?: TaskStatus | null },
): string {
  if (entity.pipelineStatusId != null) {
    const exact = choices.find((c) => c.statusId === entity.pipelineStatusId);
    if (exact) return exact.value;
  }
  if (entity.status) {
    const sameFamily = choices.find((c) => c.legacyStatus === entity.status);
    if (sameFamily) return sameFamily.value;
  }
  return NO_STATUS;
}

/**
 * The body of the `PATCH` corresponding to a choice.
 *
 * Never `status` **and** `pipelineStatusId` together: the server derives the first from the second and
 * its derivation takes precedence, so sending both would suggest an agreement that does not exist.
 */
export function bodyForChoice(
  choices: StatusChoice[],
  value: string,
): { pipelineStatusId?: number | null; status?: TaskStatus } | null {
  if (value === NO_STATUS) return { pipelineStatusId: null };
  const choice = choices.find((c) => c.value === value);
  if (!choice) return null;
  if (choice.statusId != null) return { pipelineStatusId: choice.statusId };
  return choice.legacyStatus ? { status: choice.legacyStatus } : null;
}

/** The entity as it will be after the change — for the optimistic display. */
export function withStatusOne<T extends { pipelineStatusId?: number | null; status?: TaskStatus }>(
  entity: T,
  choice: StatusChoice | null,
): T {
  return {
    ...entity,
    pipelineStatusId: choice?.statusId ?? null,
    // Both fields move together on the display side: the kanban column reads one, the badge the other,
    // and letting them diverge would make the card jump twice.
    ...(choice?.legacyStatus ? { status: choice.legacyStatus } : {}),
  };
}

/** Same, in a list: only the targeted element changes. */
export function withStatus<T extends { id: number; pipelineStatusId?: number | null; status?: TaskStatus }>(
  list: T[],
  id: number,
  choice: StatusChoice | null,
): T[] {
  return list.map((item) => (item.id === id ? withStatusOne(item, choice) : item));
}
