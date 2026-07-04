import { Select } from '../../components/ui/select';
import { TASK_TYPES } from '../project/projectTypes';
import type { SequenceSummary, UserRef } from '../../types/api';

export interface KanbanFilterState { assignee: string; type: string; sequence: string }

/** Filtres du board : assigné / type de tâche / séquence (selects natifs stylés). */
export default function KanbanFilters({ value, onChange, assignees, sequences }: {
  value: KanbanFilterState;
  onChange: (v: KanbanFilterState) => void;
  assignees: UserRef[];
  sequences: SequenceSummary[];
}) {
  const set = (patch: Partial<KanbanFilterState>) => onChange({ ...value, ...patch });
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={value.assignee} onChange={(e) => set({ assignee: e.target.value })} className="py-1.5">
        <option value="">Tous les assignés</option>
        <option value="none">Non assigné</option>
        {assignees.map((a) => <option key={a.id} value={String(a.id)}>{a.name ?? '—'}</option>)}
      </Select>
      <Select value={value.type} onChange={(e) => set({ type: e.target.value })} className="py-1.5">
        <option value="">Tous les types</option>
        {TASK_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
      </Select>
      <Select value={value.sequence} onChange={(e) => set({ sequence: e.target.value })} className="py-1.5">
        <option value="">Toutes séquences</option>
        <option value="none">Hors séquence</option>
        {sequences.map((s) => <option key={s.id} value={String(s.id)}>{s.code}</option>)}
      </Select>
    </div>
  );
}
