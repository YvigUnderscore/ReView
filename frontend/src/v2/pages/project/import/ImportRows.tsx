// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useT } from '../../../i18n';
import type { ImportReport, RowOutcome } from './types';

/**
 * Le fichier, plan par plan. On lit d'abord les chiffres, mais c'est ici qu'on vérifie
 * que « SH0010 » ira bien dans « SQ010 » et qu'il sera créé, pas écrasé.
 */
const TONE: Record<RowOutcome['action'], string> = {
  create: 'text-success',
  update: 'text-warning',
  unchanged: 'text-muted-foreground',
  blocked: 'text-destructive',
};

export default function ImportRows({ report }: { report: ImportReport }) {
  const t = useT();
  if (report.rows.length === 0) return null;
  const label: Record<RowOutcome['action'], string> = {
    create: t('csvImport.action.create'),
    update: t('csvImport.action.update'),
    unchanged: t('csvImport.action.unchanged'),
    blocked: t('csvImport.action.blocked'),
  };
  const shown = report.rows.slice(0, 60);

  return (
    <section>
      <h3 className="mb-1 text-xs font-semibold">{t('csvImport.rows')}</h3>
      <ul className="max-h-40 space-y-0.5 overflow-y-auto pr-1 text-xs">
        {shown.map((row) => (
          <li key={`${row.sequence ?? ''}-${row.shot}`} className="flex items-baseline gap-2">
            <span className="w-10 shrink-0 text-right tabular-nums text-muted-foreground">{row.line}</span>
            <code className="min-w-0 flex-1 truncate">
              {row.sequence ? `${row.sequence} / ${row.shot}` : row.shot}
            </code>
            {row.tasks.create > 0 && (
              <span className="shrink-0 text-muted-foreground">
                {t('csvImport.newTasks', { value: row.tasks.create })}
              </span>
            )}
            <span className={`w-24 shrink-0 text-right ${TONE[row.action]}`}>{label[row.action]}</span>
          </li>
        ))}
      </ul>
      {(report.truncated || report.rows.length > shown.length) && (
        <p className="mt-1 text-xs text-muted-foreground">{t('csvImport.rowsTruncated')}</p>
      )}
    </section>
  );
}
