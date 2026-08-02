// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Select } from '../../components/ui/select';
import { TASK_TYPES } from '../project/projectTypes';
import type { SequenceSummary, UserRef } from '../../types/api';
import type { KanbanFilterState } from './kanbanTypes';
import { useT } from '../../i18n';

/** Filtres du board : assigné / type de tâche / séquence (selects natifs stylés). */
export default function KanbanFilters({
  value,
  onChange,
  assignees,
  sequences,
}: {
  value: KanbanFilterState;
  onChange: (v: KanbanFilterState) => void;
  assignees: UserRef[];
  sequences: SequenceSummary[];
}) {
  const t = useT();
  const set = (patch: Partial<KanbanFilterState>) => onChange({ ...value, ...patch });
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={value.assignee} onChange={(e) => set({ assignee: e.target.value })} className="py-1.5">
        <option value="">{t('task.allAssignees')}</option>
        <option value="none">{t('activity.unassigned')}</option>
        {assignees.map((a) => (
          <option key={a.id} value={String(a.id)}>
            {a.name ?? '—'}
          </option>
        ))}
      </Select>
      <Select value={value.type} onChange={(e) => set({ type: e.target.value })} className="py-1.5">
        <option value="">{t('task.allTypes')}</option>
        {TASK_TYPES.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </Select>
      <Select value={value.sequence} onChange={(e) => set({ sequence: e.target.value })} className="py-1.5">
        <option value="">{t('task.allSequences')}</option>
        <option value="none">{t('tree.outsideSequence')}</option>
        {sequences.map((s) => (
          <option key={s.id} value={String(s.id)}>
            {s.code}
          </option>
        ))}
      </Select>
    </div>
  );
}
