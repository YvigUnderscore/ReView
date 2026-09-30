// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Download } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { useT } from '../../../i18n';
import { saveTextFile } from './api';
import { isBlocking, issueLabel, toReportCsv } from './report';
import type { ImportReport } from './types';

/**
 * Anomalies et lignes refusées, avec leur motif.
 *
 * Un studio n'importe pas un fichier parfait du premier coup : il lui faut la ligne, la
 * colonne, la valeur, et de quoi repartir dans son tableur. Le rapport se télécharge
 * entier même quand la liste affichée est écourtée.
 */
export default function ImportIssues({ report, projectId }: { report: ImportReport; projectId: number }) {
  const t = useT();
  if (report.issues.length === 0)
    return <p className="text-xs text-muted-foreground">{t('csvImport.noIssue')}</p>;

  const shown = report.issues.slice(0, 30);
  return (
    <section>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <h3 className="text-xs font-semibold">{t('csvImport.issues')}</h3>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => saveTextFile(`project-${projectId}-import-report.csv`, toReportCsv(t, report))}
        >
          <Download size={13} /> {t('csvImport.downloadReport')}
        </Button>
      </div>
      <ul className="max-h-36 space-y-0.5 overflow-y-auto pr-1 text-xs">
        {shown.map((issue, i) => (
          <li key={`${issue.code}-${issue.line ?? 0}-${i}`} className="flex gap-2">
            <span className="w-10 shrink-0 text-right tabular-nums text-muted-foreground">
              {issue.line ?? ''}
            </span>
            <span className={isBlocking(issue.code) ? 'text-destructive' : 'text-warning'}>
              {issueLabel(t, issue)}
            </span>
          </li>
        ))}
      </ul>
      {report.issues.length > shown.length && (
        <p className="mt-1 text-xs text-muted-foreground">
          {t('csvImport.moreIssues', { value: report.issues.length - shown.length })}
        </p>
      )}
    </section>
  );
}
