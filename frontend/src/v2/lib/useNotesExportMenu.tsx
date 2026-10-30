// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Film, FileJson, FileSpreadsheet, Printer } from 'lucide-react';
import { toast } from 'sonner';
import { downloadNotes, type NotesFormat, type NotesScope } from './notesExport';
import type { MenuEntry } from './menuSpec';
import { useT } from '../i18n';

/**
 * Notes export: the part common to all its call surfaces.
 *
 * The route and the client (`lib/notesExport`) already knew how to produce four formats; only
 * two were reachable, from a single panel of the review dock. The EDL and the OTIO —
 * the ones that take feedback out to the editing room — had no button,
 * no menu, no shortcut: shipped code that could not be reached.
 *
 * The list of formats, the labels, the icons and the mutation live here so that a
 * submenu, a declarative entry and a row of buttons never diverge. The
 * server refuses the EDL and the OTIO outside a sequence of shots: `notesFormatsFor` applies the
 * same rule, so as never to offer an action known to fail.
 */

/** A sequence of shots carries a continuous timecode; an isolated media item does not. */
const EDITORIAL_SCOPES: readonly NotesScope[] = ['playlist', 'timeline'];

/** Formats actually served for this scope, in display order. */
export function notesFormatsFor(scope: NotesScope): NotesFormat[] {
  return EDITORIAL_SCOPES.includes(scope) ? ['csv', 'sheet', 'edl', 'otio'] : ['csv', 'sheet'];
}

/** Icon of each format — the same everywhere, so they are recognised from one screen to the next. */
export const NOTES_FORMAT_ICONS: Record<NotesFormat, ReactNode> = {
  csv: <FileSpreadsheet size={14} />,
  sheet: <Printer size={14} />,
  edl: <Film size={14} />,
  otio: <FileJson size={14} />,
};

export interface NotesExportTarget {
  scope: NotesScope;
  id: number;
}

/** Starts an export and reports back: name of the file obtained, truncation, failure. */
export function useNotesDownload({ scope, id }: NotesExportTarget) {
  const t = useT();
  const run = useMutation({
    mutationFn: (format: NotesFormat) => downloadNotes({ scope, id, format }),
    onSuccess: (result) => {
      toast.success(t('notesExport.done', { name: result.filename }));
      if (result.truncated) toast.warning(t('notesExport.partial'));
    },
    onError: (err: Error) => toast.error(err.message || t('notesExport.failed')),
  });
  return { start: (format: NotesFormat) => run.mutate(format), busy: run.isPending, pending: run.variables };
}

/**
 * Format labels. A function, not a module constant: a table frozen at
 * load time would keep the language of startup.
 */
export function useNotesFormatLabels(): Record<NotesFormat, string> {
  const t = useT();
  return {
    csv: t('notesExport.csv'),
    sheet: t('notesExport.sheet'),
    edl: t('notesExport.edl'),
    otio: t('notesExport.otio'),
  };
}

/** "Review notes" submenu described as data, for `EntityContextMenu`. */
export function useNotesExportEntry({ scope, id }: NotesExportTarget): MenuEntry {
  const t = useT();
  const labels = useNotesFormatLabels();
  const { start, busy } = useNotesDownload({ scope, id });
  return {
    kind: 'submenu',
    id: 'notes-export',
    label: t('notesExport.title'),
    icon: <FileSpreadsheet size={14} />,
    items: notesFormatsFor(scope).map((format) => ({
      id: `notes-export-${format}`,
      label: labels[format],
      icon: NOTES_FORMAT_ICONS[format],
      disabled: busy,
      onSelect: () => start(format),
    })),
  };
}
