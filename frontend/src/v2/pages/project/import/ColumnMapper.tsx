// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Select } from '../../../components/ui/select';
import { useT } from '../../../i18n';
import { fieldLabel } from './report';
import { CSV_FIELDS, type CsvField, type DetectedColumn } from './types';

/**
 * Correspondance des colonnes, assistée.
 *
 * Le serveur a déjà reconnu ce qu'il pouvait (`sg_sequence`, « Échéance », `cut_in`…) ;
 * cet écran montre son verdict colonne par colonne et laisse le corriger. C'est ce qui
 * évite de renvoyer le studio réécrire l'en-tête de son export.
 */
export default function ColumnMapper({
  columns,
  onChange,
}: {
  columns: DetectedColumn[];
  onChange: (index: number, field: CsvField | null) => void;
}) {
  const t = useT();
  const taken = new Set(columns.map((c) => c.field).filter((f): f is CsvField => f !== null));
  const unmapped = columns.filter((c) => c.field === null).length;

  return (
    <section className="rounded border border-border bg-secondary/30 p-2">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="text-xs font-semibold">{t('csvImport.columns')}</h3>
        {unmapped > 0 && (
          <span className="text-xs text-muted-foreground">
            {t('csvImport.unmapped', { value: unmapped })}
          </span>
        )}
      </div>
      <ul className="grid max-h-40 gap-1 overflow-y-auto pr-1 sm:grid-cols-2">
        {columns.map((column) => (
          <li key={column.index} className="flex items-center gap-2">
            <code
              className="min-w-0 flex-1 truncate rounded bg-background px-1.5 py-1 text-xs"
              title={column.header}
            >
              {column.header || `#${column.index + 1}`}
            </code>
            <Select
              aria-label={t('csvImport.columnFor', { column: column.header })}
              className="w-40 shrink-0 px-2 py-1 text-xs"
              value={column.field ?? ''}
              onChange={(e) => onChange(column.index, (e.target.value || null) as CsvField | null)}
            >
              <option value="">{t('csvImport.ignored')}</option>
              {CSV_FIELDS.filter((field) => field === column.field || !taken.has(field)).map((field) => (
                <option key={field} value={field}>
                  {fieldLabel(t, field)}
                </option>
              ))}
            </Select>
          </li>
        ))}
      </ul>
    </section>
  );
}
