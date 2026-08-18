// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Link } from 'react-router-dom';
import type { Family, MatrixCell, ProductionOverview } from '../../types/production';
import { useT, type MessageKey } from '../../i18n';

/**
 * Où en est le projet (C6) : séquences en lignes, départements en colonnes.
 *
 * L'onglet alignait des moyennes — temps par plan, notes par version — dont aucune ne
 * disait où en était le film. Ce tableau le dit d'un coup d'œil : chaque case porte la
 * part de travail terminé, et les couleurs restent celles des familles de statut.
 */

const FAMILY_BAR: Record<Family, string> = {
  todo: 'bg-muted-foreground/40',
  progress: 'bg-info',
  review: 'bg-warning',
  done: 'bg-success',
  blocked: 'bg-destructive',
};

const FAMILY_LABEL: Record<Family, MessageKey> = {
  todo: 'kanban.family.todo',
  progress: 'kanban.family.progress',
  review: 'kanban.family.review',
  done: 'kanban.family.done',
  blocked: 'kanban.family.blocked',
};

const FAMILIES: Family[] = ['done', 'review', 'progress', 'blocked', 'todo'];

function Cell({ cell }: { cell: MatrixCell | undefined }) {
  const t = useT();
  if (!cell || cell.total === 0) return <td className="px-2 py-1.5 text-center text-muted-foreground">—</td>;
  const title = FAMILIES.filter((f) => cell[f] > 0)
    .map((f) => `${t(FAMILY_LABEL[f])} ${cell[f]}`)
    .join(' · ');
  return (
    <td className="px-2 py-1.5" title={title}>
      <span className="flex h-2 w-full overflow-hidden rounded-full bg-secondary">
        {FAMILIES.map((f) =>
          cell[f] > 0 ? (
            <span key={f} className={FAMILY_BAR[f]} style={{ width: `${(cell[f] / cell.total) * 100}%` }} />
          ) : null,
        )}
      </span>
      <span className="mt-0.5 block text-center text-2xs tabular-nums text-muted-foreground">
        {cell.done}/{cell.total}
      </span>
    </td>
  );
}

export default function ProgressMatrix({ data }: { data: ProductionOverview }) {
  const t = useT();
  const byKey = new Map(data.matrix.map((c) => [`${c.sequenceId ?? 'none'}::${c.department ?? 'none'}`, c]));
  const hasUnsequenced = data.matrix.some((c) => c.sequenceId === null);
  const hasNoDepartment = data.matrix.some((c) => c.department === null);
  const columns = [...data.departments, ...(hasNoDepartment ? [null] : [])];
  const rows: { id: number | null; code: string }[] = [
    ...data.sequences,
    ...(hasUnsequenced ? [{ id: null, code: t('tree.outsideSequence') }] : []),
  ];

  if (columns.length === 0 || rows.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('production.matrix.empty')}</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[40rem] border-collapse text-xs">
        <thead>
          <tr>
            <th className="sticky left-0 bg-background px-2 py-1.5 text-left font-medium text-muted-foreground">
              {t('sequences.title')}
            </th>
            {columns.map((d) => (
              <th key={d ?? 'none'} className="px-2 py-1.5 font-medium text-muted-foreground">
                {d ?? t('filters.noDepartment')}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id ?? 'none'} className="border-t border-border">
              <th className="sticky left-0 bg-background px-2 py-1.5 text-left font-medium">
                {row.id !== null ? (
                  <Link to={`/sequences/${row.id}`} className="hover:text-primary hover:underline">
                    {row.code}
                  </Link>
                ) : (
                  row.code
                )}
              </th>
              {columns.map((d) => (
                <Cell key={d ?? 'none'} cell={byKey.get(`${row.id ?? 'none'}::${d ?? 'none'}`)} />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
