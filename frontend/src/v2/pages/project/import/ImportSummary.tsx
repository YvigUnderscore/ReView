// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { intlLocale, useT } from '../../../i18n';
import type { ImportCounts } from './types';

/**
 * Ce que l'import va faire, en chiffres.
 *
 * Trois colonnes — créer, mettre à jour, laisser tel quel — parce que c'est la question
 * qu'on se pose devant un fichier venu d'ailleurs : « qu'est-ce que ça va casser ? ».
 * Rejouer un fichier déjà importé remplit la seule colonne « inchangé ».
 */
export default function ImportSummary({ counts }: { counts: ImportCounts }) {
  const t = useT();
  const n = (value: number) => value.toLocaleString(intlLocale());

  const lines: { label: string; create: number; update: number | null; same: number | null }[] = [
    { label: t('csvImport.field.episode'), create: counts.episodesToCreate, update: null, same: null },
    { label: t('common.sequence'), create: counts.sequencesToCreate, update: null, same: null },
    {
      label: t('csvImport.field.shot'),
      create: counts.shotsToCreate,
      update: counts.shotsToUpdate,
      same: counts.shotsUnchanged,
    },
    {
      label: t('csvImport.field.task'),
      create: counts.tasksToCreate,
      update: counts.tasksToUpdate,
      same: counts.tasksUnchanged,
    },
  ];

  return (
    <section>
      <table className="w-full text-xs">
        <thead className="text-muted-foreground">
          <tr>
            <th scope="col" className="py-1 text-left font-medium">
              {t('csvImport.summary')}
            </th>
            <th scope="col" className="py-1 text-right font-medium">
              {t('csvImport.toCreate')}
            </th>
            <th scope="col" className="py-1 text-right font-medium">
              {t('csvImport.toUpdate')}
            </th>
            <th scope="col" className="py-1 text-right font-medium">
              {t('csvImport.unchanged')}
            </th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.label} className="border-t border-border">
              <th scope="row" className="py-1 text-left font-normal">
                {line.label}
              </th>
              <td className="py-1 text-right tabular-nums">{n(line.create)}</td>
              <td className="py-1 text-right tabular-nums text-muted-foreground">
                {line.update === null ? '—' : n(line.update)}
              </td>
              <td className="py-1 text-right tabular-nums text-muted-foreground">
                {line.same === null ? '—' : n(line.same)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {(counts.rowsRejected > 0 || counts.warnings > 0) && (
        <p className="mt-1 text-xs text-muted-foreground">
          {t('csvImport.rejectedAndWarnings', {
            rejected: n(counts.rowsRejected),
            warnings: n(counts.warnings),
          })}
        </p>
      )}
    </section>
  );
}
