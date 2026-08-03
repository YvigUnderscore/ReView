// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { Upload, Download } from 'lucide-react';
import { toast } from 'sonner';
import { api, getToken } from '../../../lib/apiClient';
import { Button } from '../../components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { useT } from '../../i18n';

interface ImportResult {
  committed: boolean;
  sequencesToCreate: number;
  shotsToCreate: number;
  tasksToCreate: number;
  shotsSkipped: number;
  errors: string[];
}

/**
 * Passerelle CSV du projet (38.F/38.G) : import shots/tâches (dry-run puis commit) et export.
 * Format : colonnes sequence, shot, name, tasks (« | »). Réservé aux gestionnaires.
 */
export default function ProjectCsvActions({
  projectId,
  onImported,
}: {
  projectId: number;
  onImported: () => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [csv, setCsv] = useState('');
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (commit: boolean) => {
    if (!csv.trim()) return;
    setBusy(true);
    try {
      const res = await api.post<ImportResult>(`/api/projects/${projectId}/import-csv`, { csv, commit });
      if (commit) {
        toast.success(t('csv.imported', { shots: res.shotsToCreate, tasks: res.tasksToCreate }));
        setOpen(false);
        setCsv('');
        setPreview(null);
        onImported();
      } else {
        setPreview(res);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('common.error.generic'));
    } finally {
      setBusy(false);
    }
  };

  const exportCsv = async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/export-csv`, {
        headers: getToken() ? { Authorization: `Bearer ${getToken()}` } : {},
      });
      if (!res.ok) throw new Error(t('common.error.export'));
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `project-${projectId}-shots.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('common.error.generic'));
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 hover:bg-secondary/60"
      >
        <Upload size={16} /> {t('csv.import')}
      </button>
      <button
        onClick={exportCsv}
        className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 hover:bg-secondary/60"
      >
        <Download size={16} /> {t('csv.export')}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('shots.import')}</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            {t('csv.columns')} <code>sequence, shot, name, tasks</code> {t('csv.taskHint')}
          </p>
          <textarea
            className="h-40 w-full rounded border border-input bg-background p-2 font-mono text-xs"
            placeholder={t('csv.placeholder')}
            value={csv}
            onChange={(e) => {
              setCsv(e.target.value);
              setPreview(null);
            }}
          />
          {preview && (
            <div className="rounded border border-border bg-secondary/40 p-2 text-xs">
              <div>
                {t('csv.preview', {
                  sequences: preview.sequencesToCreate,
                  shots: preview.shotsToCreate,
                  tasks: preview.tasksToCreate,
                  skipped: preview.shotsSkipped,
                })}
              </div>
              {preview.errors.length > 0 && (
                <ul className="mt-1 list-inside list-disc text-destructive">
                  {preview.errors.slice(0, 8).map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={() => void run(false)} disabled={busy}>
              {t('common.preview')}
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => void run(true)}
              disabled={busy || !preview || preview.shotsToCreate === 0}
            >
              {t('common.import')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
