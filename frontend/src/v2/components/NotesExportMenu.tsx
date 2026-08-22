// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { FileSpreadsheet, Loader2 } from 'lucide-react';
import { Button } from './ui/button';
import {
  ContextMenuItem,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from './ui/context-menu';
import {
  notesFormatsFor,
  useNotesDownload,
  useNotesFormatLabels,
  NOTES_FORMAT_ICONS,
  type NotesExportTarget,
} from '../lib/useNotesExportMenu';
import { useT } from '../i18n';

/**
 * Les deux rendus « visuels » de l'export des notes : un sous-menu de clic droit, et une
 * rangée de boutons pour un panneau de dock qui a déjà son titre de groupe. La liste des
 * formats et la mutation viennent de `lib/useNotesExportMenu`, que partage aussi la
 * variante déclarative (`EntityContextMenu`).
 */

/** Sous-menu pour un menu contextuel écrit à la main (primitives Radix). */
export function NotesExportSubmenu({ scope, id }: NotesExportTarget) {
  const t = useT();
  const labels = useNotesFormatLabels();
  const { start, busy } = useNotesDownload({ scope, id });

  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger>
        <FileSpreadsheet size={14} /> {t('notesExport.title')}
      </ContextMenuSubTrigger>
      <ContextMenuSubContent>
        {notesFormatsFor(scope).map((format) => (
          <ContextMenuItem key={format} disabled={busy} onSelect={() => start(format)}>
            {NOTES_FORMAT_ICONS[format]} {labels[format]}
          </ContextMenuItem>
        ))}
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}

/**
 * Rangée de boutons. Le format en cours porte le rouet : une planche imprimable compose
 * une image par note et prend plusieurs secondes.
 */
export function NotesExportButtons({ scope, id }: NotesExportTarget) {
  const labels = useNotesFormatLabels();
  const { start, busy, pending } = useNotesDownload({ scope, id });

  return (
    <>
      {notesFormatsFor(scope).map((format, index) => (
        <Button
          key={format}
          size="sm"
          variant={index === 0 ? 'outline' : 'ghost'}
          disabled={busy}
          onClick={() => start(format)}
        >
          {busy && pending === format ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            NOTES_FORMAT_ICONS[format]
          )}
          {labels[format]}
        </Button>
      ))}
    </>
  );
}
