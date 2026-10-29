// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Upload, Download } from 'lucide-react';
import { toast } from 'sonner';
import { useT } from '../../i18n';
import { downloadProjectCsv } from './import/api';
import ImportCsvDialog from './import/ImportCsvDialog';

/**
 * CSV gateway of the project: BOM import (preview, then write) and export.
 * Reserved for project managers: it is mounted by `ProjectPage`.
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
  const exportCsv = useMutation({
    mutationFn: () => downloadProjectCsv(projectId),
    onError: (err: Error) => toast.error(err.message || t('common.error.generic')),
  });

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 hover:bg-secondary/60"
      >
        <Upload size={16} /> {t('csv.import')}
      </button>
      <button
        onClick={() => exportCsv.mutate()}
        disabled={exportCsv.isPending}
        className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 hover:bg-secondary/60"
      >
        <Download size={16} /> {t('csv.export')}
      </button>

      <ImportCsvDialog projectId={projectId} open={open} onOpenChange={setOpen} onImported={onImported} />
    </>
  );
}
