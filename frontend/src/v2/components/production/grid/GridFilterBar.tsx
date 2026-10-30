// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Select } from '../../ui/select';
import { Checkbox } from '../../ui/checkbox';
import { Button } from '../../ui/button';
import { useEpisodesEnabled, useEpisodesQuery } from '@/v2/lib/episodesApi';
import { useSequencesQuery } from '@/v2/lib/queries';
import { useDepartments } from '@/v2/lib/departmentsApi';
import { useProjectMembers } from '@/v2/lib/useProjectRole';
import { usePipelineStatuses } from '@/v2/lib/shotgridApi';
import { TASK_STATUSES, TASK_STATUS_LABEL_KEY } from '@/v2/lib/taskStatus';
import { NO_FILTERS, hasFilters, type GridFilters } from './gridWire';
import { useT } from '@/v2/i18n';

/**
 * The grid's filters.
 *
 * Five of them are served by the route, which applies them in the database: a shot remains an ENTIRE row, and the filter
 * decides whether it is displayed, never which cells it shows. A grid whose columns empty out when filtering can no longer
 * be read.
 *
 * The sixth, hiding empty columns, is purely local: it asks nothing of the server, and removes the departments that no shot
 * on the page has on its schedule.
 */

/** "All" sentinel: an `<option>` cannot carry an absent value. */
const ALL = 'all';

const asNumber = (value: string): number | null => (value === ALL ? null : Number(value));
const asText = (value: string): string | null => (value === ALL ? null : value);

export default function GridFilterBar({
  projectId,
  filters,
  onChange,
  hideEmpty,
  onHideEmptyChange,
}: {
  projectId: number;
  filters: GridFilters;
  onChange: (filters: GridFilters) => void;
  hideEmpty: boolean;
  onHideEmptyChange: (hide: boolean) => void;
}) {
  const t = useT();
  const episodesOn = useEpisodesEnabled(projectId);
  const episodesQ = useEpisodesQuery(projectId, episodesOn);
  const sequencesQ = useSequencesQuery(projectId, projectId > 0);
  const departmentsQ = useDepartments(projectId, projectId > 0);
  const members = useProjectMembers(projectId);
  const statusesQ = usePipelineStatuses('task', projectId);

  const statuses = statusesQ.data ?? [];
  // Without reference data, the server accepts the value of the frozen enum: these are the same labels as everywhere
  // else, and the route can read both vocabularies.
  const statusOptions =
    statuses.length > 0
      ? statuses.map((status) => ({ value: status.code, label: status.name }))
      : TASK_STATUSES.map((status) => ({ value: status, label: t(TASK_STATUS_LABEL_KEY[status]) }));

  return (
    <div className="flex flex-wrap items-center gap-2">
      {episodesOn && (
        <Select
          className="py-1 text-xs"
          aria-label={t('production.grid.filterEpisode')}
          value={filters.episodeId === null ? ALL : String(filters.episodeId)}
          onChange={(e) => onChange({ ...filters, episodeId: asNumber(e.target.value) })}
        >
          <option value={ALL}>{t('production.grid.allEpisodes')}</option>
          {(episodesQ.data?.episodes ?? []).map((episode) => (
            <option key={episode.id} value={episode.id}>
              {episode.code}
            </option>
          ))}
        </Select>
      )}

      <Select
        className="py-1 text-xs"
        aria-label={t('production.grid.filterSequence')}
        value={filters.sequenceId === null ? ALL : String(filters.sequenceId)}
        onChange={(e) => onChange({ ...filters, sequenceId: asNumber(e.target.value) })}
      >
        <option value={ALL}>{t('task.allSequences')}</option>
        {(sequencesQ.data?.sequences ?? []).map((sequence) => (
          <option key={sequence.id} value={sequence.id}>
            {sequence.code}
          </option>
        ))}
      </Select>

      <Select
        className="py-1 text-xs"
        aria-label={t('production.grid.filterDepartment')}
        value={filters.department ?? ALL}
        onChange={(e) => onChange({ ...filters, department: asText(e.target.value) })}
      >
        <option value={ALL}>{t('filters.allDepartments')}</option>
        {(departmentsQ.data ?? []).map((department) => (
          <option key={department.key} value={department.key}>
            {department.name}
          </option>
        ))}
      </Select>

      <Select
        className="py-1 text-xs"
        aria-label={t('production.grid.filterAssignee')}
        value={filters.assigneeId === null ? ALL : String(filters.assigneeId)}
        onChange={(e) => onChange({ ...filters, assigneeId: asNumber(e.target.value) })}
      >
        <option value={ALL}>{t('task.allAssignees')}</option>
        {members.map((member) => (
          <option key={member.id} value={member.id}>
            {member.name}
          </option>
        ))}
      </Select>

      <Select
        className="py-1 text-xs"
        aria-label={t('production.grid.filterStatus')}
        value={filters.status ?? ALL}
        onChange={(e) => onChange({ ...filters, status: asText(e.target.value) })}
      >
        <option value={ALL}>{t('filters.allStatuses')}</option>
        {statusOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>

      <label htmlFor="grid-hide-empty" className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Checkbox
          id="grid-hide-empty"
          checked={hideEmpty}
          onCheckedChange={(v) => onHideEmptyChange(v === true)}
        />
        {t('production.grid.hideEmptyColumns')}
      </label>

      {hasFilters(filters) && (
        <Button variant="ghost" size="sm" onClick={() => onChange({ ...NO_FILTERS })}>
          {t('filters.clear')}
        </Button>
      )}
    </div>
  );
}
