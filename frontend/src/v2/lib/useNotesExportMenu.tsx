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
 * Export des notes : la partie commune à toutes ses surfaces d'appel.
 *
 * La route et le client (`lib/notesExport`) savaient déjà produire quatre formats ; seuls
 * deux étaient atteignables, depuis un unique panneau du dock de review. L'EDL et l'OTIO —
 * ceux qui font sortir les retours vers la salle de montage — n'avaient aucun bouton,
 * aucun menu, aucun raccourci : du code livré et injoignable.
 *
 * La liste des formats, les libellés, les icônes et la mutation vivent ici pour qu'un
 * sous-menu, une entrée déclarative et une rangée de boutons ne divergent jamais. Le
 * serveur refuse l'EDL et l'OTIO hors d'une suite de plans : `notesFormatsFor` applique la
 * même règle, pour ne jamais proposer une action dont on sait qu'elle échouera.
 */

/** Une suite de plans porte un timecode continu ; un média isolé, non. */
const EDITORIAL_SCOPES: readonly NotesScope[] = ['playlist', 'timeline'];

/** Formats réellement servis pour cette portée, dans l'ordre d'affichage. */
export function notesFormatsFor(scope: NotesScope): NotesFormat[] {
  return EDITORIAL_SCOPES.includes(scope) ? ['csv', 'sheet', 'edl', 'otio'] : ['csv', 'sheet'];
}

/** Icône de chaque format — la même partout, pour qu'on les reconnaisse d'un écran à l'autre. */
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

/** Lance un export et rend compte : nom du fichier obtenu, troncature, échec. */
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
 * Libellés des formats. Une fonction, pas une constante de module : une table figée au
 * chargement garderait la langue du démarrage.
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

/** Sous-menu « notes de review » décrit en données, pour `EntityContextMenu`. */
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
