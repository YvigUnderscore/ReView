// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';
import { FileSpreadsheet, Loader2, Printer } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../../../components/ui/button';
import { Group } from '../chrome/DockGroup';
import { downloadNotes, type NotesExportRequest, type NotesFormat } from '../../../lib/notesExport';
import { useT } from '../../../i18n';

/**
 * Sortie des notes depuis le panneau Export du dock.
 *
 * Deux formats seulement ici : le tableur, que la production attend, et la planche
 * imprimable, qui montre chaque note sur sa frame. L'EDL et l'OTIO n'ont de sens que sur
 * une suite de clips — ils se déclenchent depuis une playlist ou un montage, avec le même
 * `downloadNotes`.
 *
 * Le panneau Export existe déjà : y poser deux entrées n'ajoute aucune surface à
 * l'interface, c'est l'endroit où l'on cherche un export.
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
