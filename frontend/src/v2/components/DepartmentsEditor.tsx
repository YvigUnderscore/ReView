// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react';
import type { DepartmentSummary } from '../types/api';
import { useT } from '../i18n';

/**
 * Editing departments: the ORDERED list of the pipeline (Phase 45).
 *
 * The order is not cosmetic: it defines upstream and downstream, and therefore what
 * the application calls "the latest version" of an asset or a shot, and what an
 * automatic edit fetches. Hence the arrows, and the explicit note above.
 *
 * Shared by a project's settings and the studio defaults: two screens that
 * edited the same data with two different forms.
 */
export default function DepartmentsEditor({
  value,
  onChange,
}: {
  value: DepartmentSummary[];
  onChange: (departments: DepartmentSummary[]) => void;
}) {
  const t = useT();

  const setField = (i: number, k: keyof DepartmentSummary, v: string) =>
    onChange(value.map((dep, idx) => (idx === i ? { ...dep, [k]: v } : dep)));
  const remove = (i: number) => onChange(value.filter((_, idx) => idx !== i));
  const add = () => onChange([...value, { key: '', name: '' }]);
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= value.length) return;
    const next = [...value];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  return (
    <div className="space-y-1.5">
      <p className="mb-2 text-xs text-muted-foreground">{t('pipeline.dept.orderHint')}</p>
      {value.map((dep, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-5 shrink-0 text-right text-2xs tabular-nums text-muted-foreground">{i + 1}</span>
          <div className="flex shrink-0 flex-col">
            <button
              onClick={() => move(i, -1)}
              disabled={i === 0}
              title={t('pipeline.dept.moveUp')}
              className="flex h-3.5 w-5 items-center justify-center rounded text-muted-foreground hover:text-foreground disabled:opacity-25"
            >
              <ChevronUp size={12} />
            </button>
            <button
              onClick={() => move(i, 1)}
              disabled={i === value.length - 1}
              title={t('pipeline.dept.moveDown')}
              className="flex h-3.5 w-5 items-center justify-center rounded text-muted-foreground hover:text-foreground disabled:opacity-25"
            >
              <ChevronDown size={12} />
            </button>
          </div>
          <input
            className="w-32 rounded border border-input bg-background px-2 py-1.5 text-xs"
            placeholder={t('pipeline.dept.key.placeholder')}
            aria-label={t('pipeline.dept.key.placeholder')}
            value={dep.key}
            onChange={(e) => setField(i, 'key', e.target.value)}
          />
          <input
            className="flex-1 rounded border border-input bg-background px-2 py-1.5 text-xs"
            placeholder={t('pipeline.dept.name.placeholder')}
            aria-label={t('pipeline.dept.name.placeholder')}
            value={dep.name}
            onChange={(e) => setField(i, 'name', e.target.value)}
          />
          <button
            onClick={() => remove(i)}
            title={t('common.remove')}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-destructive"
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      <button
        onClick={add}
        className="mt-1 flex items-center gap-1 rounded border border-border px-2 py-1.5 text-xs hover:bg-secondary/60"
      >
        <Plus size={14} /> {t('common.department')}
      </button>
    </div>
  );
}
