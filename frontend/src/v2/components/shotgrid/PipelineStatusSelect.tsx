// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { usePipelineStatuses } from '../../lib/shotgridApi';
import { useT } from '../../i18n';
import { TASK_STATUSES, TASK_STATUS_LABEL_KEY, TASK_STATUS_COLOR } from '../../lib/taskStatus';
import type { TaskStatus } from '../../types/api';
import type { StatusScope } from '../../types/shotgrid';

/**
 * Status selector using the project's own vocabulary.
 *
 * The `PipelineStatus` catalogue already existed and ShotGrid sync filled it, but no
 * selector read it: all of them offered the six fixed enum values. A supervisor on a
 * ShotGrid project could therefore not set "Ready to Start" or "On Hold", and saw
 * "Approved" where the site says "Supervisor Approved".
 *
 * The fallback to the six fixed statuses is kept for two cases: while the request is
 * in flight, and for a studio whose catalogue was never populated.
 */
export default function PipelineStatusSelect({
  projectId,
  scope,
  statusId,
  legacyStatus,
  onChange,
  className = '',
  disabled,
}: {
  projectId: number;
  /** A sequence has its own status vocabulary, distinct from a plan's (C3). */
  scope: StatusScope;
  /** Catalogue status, when the entity has one. */
  statusId: number | null | undefined;
  /** Enum value; the only information available on legacy entities. */
  legacyStatus?: TaskStatus | null;
  onChange: (next: { statusId: number | null; legacyStatus: TaskStatus }) => void;
  className?: string;
  disabled?: boolean;
}) {
  const t = useT();
  const { data: statuses = [] } = usePipelineStatuses(scope, projectId);

  if (statuses.length === 0) {
    // Fallback: the fixed vocabulary, as long as no catalogue is available.
    return (
      <select
        aria-label={t('common.status')}
        value={legacyStatus ?? 'TODO'}
        disabled={disabled}
        onChange={(e) => onChange({ statusId: null, legacyStatus: e.target.value as TaskStatus })}
        className={`rounded px-1 py-0.5 text-xs ${TASK_STATUS_COLOR[legacyStatus ?? 'TODO'] ?? ''} ${className}`}
      >
        {TASK_STATUSES.map((s) => (
          <option key={s} value={s}>
            {t(TASK_STATUS_LABEL_KEY[s])}
          </option>
        ))}
      </select>
    );
  }

  // The entity may only carry its legacy value: look up the catalogue status that
  // represents it, rather than showing a list with no selection.
  const current =
    statuses.find((s) => s.id === statusId) ??
    (legacyStatus ? statuses.find((s) => s.legacyStatus === legacyStatus) : undefined);

  return (
    // `title` carries the catalogue code: it is a detail, not a name. Without an
    // `aria-label`, a kanban page announced as many "dropdowns" as there were cards,
    // since every card has this selector.
    <select
      aria-label={t('common.status')}
      value={current?.id ?? ''}
      disabled={disabled}
      onChange={(e) => {
        const next = statuses.find((s) => s.id === Number(e.target.value));
        if (next) onChange({ statusId: next.id, legacyStatus: next.legacyStatus ?? 'TODO' });
      }}
      style={current ? { backgroundColor: `${current.color}22`, color: current.color } : undefined}
      className={`rounded px-1 py-0.5 text-xs ${className}`}
      title={current?.code}
    >
      {!current && <option value="">{t('pipeline.status.none')}</option>}
      {statuses.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
        </option>
      ))}
    </select>
  );
}
