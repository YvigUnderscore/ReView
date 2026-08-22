// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState, type ChangeEvent, type DragEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog';
import { useT } from '../../../i18n';
import { fetchTemplate, runImport, saveTextFile } from './api';
import ColumnMapper from './ColumnMapper';
import ImportIssues from './ImportIssues';
import ImportRows from './ImportRows';
import ImportSummary from './ImportSummary';
import { hasWork, type ColumnOverride, type CsvField, type ImportReport } from './types';

/**
 * Import de nomenclature : le chemin d'entrée d'un studio dans ReView.
 *
 * L'écran suit l'ordre dans lequel on se pose les questions — quel fichier, quelles
 * colonnes, qu'est-ce que ça va faire, puis seulement écrire. Rien n'est envoyé en base
 * tant que l'aperçu n'a pas été demandé, et le bouton d'écriture reste éteint tant qu'il
 * n'y a rien à écrire.
 */
export default function ImportCsvDialog({
  projectId,
  open,
  onOpenChange,
  onImported,
}: {
  projectId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
}) {
  const t = useT();
  const [csv, setCsv] = useState('');
  const [mapping, setMapping] = useState<ColumnOverride[]>([]);
  const [report, setReport] = useState<ImportReport | null>(null);

  const reset = () => {
    setCsv('');
    setMapping([]);
    setReport(null);
  };

  const run = useMutation({
    mutationFn: (commit: boolean) => runImport(projectId, { csv, commit, mapping }),
    onSuccess: (result) => {
      setReport(result);
      if (!result.committed) return;
      toast.success(
        t('csvImport.done', { shots: result.counts.shotsToCreate, tasks: result.counts.tasksToCreate }),
      );
      onOpenChange(false);
      reset();
      onImported();
    },
    onError: (err: Error) => toast.error(err.message || t('common.error.generic')),
  });

  const template = useMutation({
    mutationFn: () => fetchTemplate(projectId),
    onSuccess: (text) => saveTextFile('review-import-template.csv', text),
    onError: (err: Error) => toast.error(err.message || t('csvImport.templateFailed')),
  });

  const load = (file: File | undefined) => {
    if (!file) return;
    void file.text().then((text) => {
      setCsv(text);
      setReport(null);
      setMapping([]);
    });
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    load(e.dataTransfer.files[0]);
  };

  const remap = (index: number, field: CsvField | null) => {
    setMapping((current) => [...current.filter((m) => m.index !== index), { index, field }]);
    setReport(null);
  };

  const busy = run.isPending;
  const ready = report !== null && hasWork(report.counts);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) reset();
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('csvImport.title')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">{t('csvImport.intro')}</p>

          {/* Dépôt de fichier : confort à la souris seulement — le champ ci-dessous ouvre
              le même sélecteur au clavier, et la zone de saisie accepte un collage. */}
          <div onDrop={onDrop} onDragOver={(e) => e.preventDefault()} className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="file"
                accept=".csv,text/csv,text/plain"
                aria-label={t('csvImport.chooseFile')}
                className="text-xs file:mr-2 file:rounded file:border file:border-border file:bg-secondary/60 file:px-2 file:py-1 file:text-xs"
                onChange={(e: ChangeEvent<HTMLInputElement>) => load(e.target.files?.[0])}
              />
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={template.isPending}
                onClick={() => template.mutate()}
              >
                {template.isPending ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                {t('csvImport.template')}
              </Button>
            </div>
            <textarea
              className="h-28 w-full rounded border border-input bg-background p-2 font-mono text-xs"
              placeholder={t('csvImport.placeholder')}
              aria-label={t('csvImport.title')}
              value={csv}
              onChange={(e) => {
                setCsv(e.target.value);
                setReport(null);
              }}
            />
          </div>

          {report && (
            <>
              <ColumnMapper columns={report.columns} onChange={remap} />
              <ImportSummary counts={report.counts} />
              <ImportRows report={report} />
              <ImportIssues report={report} projectId={projectId} />
              {!hasWork(report.counts) && (
                <p className="text-xs text-success">{t('csvImport.alreadyUpToDate')}</p>
              )}
            </>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy || csv.trim() === ''}
            onClick={() => run.mutate(false)}
          >
            {busy && !run.variables ? <Loader2 size={13} className="animate-spin" /> : null}
            {report ? t('csvImport.refresh') : t('common.preview')}
          </Button>
          <Button type="button" size="sm" disabled={busy || !ready} onClick={() => run.mutate(true)}>
            {busy && run.variables ? <Loader2 size={13} className="animate-spin" /> : null}
            {t('common.import')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
