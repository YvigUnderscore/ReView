// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';
import { FileSpreadsheet, Loader2, Printer } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/v2/components/ui/button';
import { Group } from '../chrome/DockGroup';
import { downloadNotes, type NotesExportRequest, type NotesFormat } from '@/v2/lib/notesExport';
import { useT } from '@/v2/i18n';

/**
 * Notes output from the dock's Export panel.
 *
 * Only two formats here: the spreadsheet, which production expects, and the printable contact sheet,
 * which shows each note on its frame. EDL and OTIO only make sense on a sequence of clips: they are
 * triggered from a playlist or an edit, with the same `downloadNotes`.
 *
 * The Export panel already exists: adding two entries there adds no surface to the interface; it is
 * where one looks for an export.
 */
export default function NotesExportPanel({ scope, id }: { scope: NotesExportRequest['scope']; id: number }) {
  const t = useT();
  const run = useMutation({
    mutationFn: (format: NotesFormat) => downloadNotes({ scope, id, format }),
    onSuccess: (result) => {
      toast.success(t('notesExport.done', { name: result.filename }));
      if (result.truncated) toast.warning(t('notesExport.partial'));
    },
    onError: (err: Error) => toast.error(err.message || t('notesExport.failed')),
  });
  const busy = run.isPending;
  const icon = (format: NotesFormat, fallback: ReactNode) =>
    busy && run.variables === format ? <Loader2 size={13} className="animate-spin" /> : fallback;

  return (
    <Group title={t('notesExport.title')}>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => run.mutate('csv')}>
        {icon('csv', <FileSpreadsheet size={13} />)}
        {t('notesExport.csv')}
      </Button>
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => run.mutate('sheet')}>
        {icon('sheet', <Printer size={13} />)}
        {t('notesExport.sheet')}
      </Button>
      <span className="rv-optbar__hint whitespace-normal">{t('notesExport.hint')}</span>
    </Group>
  );
}
