// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { Heading2, Heading3, Image, Images, Minus, Percent, Plus, Type } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '../../ui/popover';
import type { EditorBlockKind } from '../noteEditorModel';
import { useT } from '../../../i18n';

/**
 * Add a block, at the exact place where one is.
 *
 * A toolbar at the top of the editor would have forced inserting at the bottom and then moving the block up; the button
 * therefore lives **between** the blocks and only appears on hovering the gap: the note stays a note, not a dashboard.
 */

const KINDS: { kind: EditorBlockKind; icon: typeof Type; labelKey: `note.block.${EditorBlockKind}` }[] = [
  { kind: 'text', icon: Type, labelKey: 'note.block.text' },
  { kind: 'title', icon: Heading3, labelKey: 'note.block.title' },
  { kind: 'heading', icon: Heading2, labelKey: 'note.block.heading' },
  { kind: 'gallery', icon: Images, labelKey: 'note.block.gallery' },
  { kind: 'image', icon: Image, labelKey: 'note.block.image' },
  { kind: 'progress', icon: Percent, labelKey: 'note.block.progress' },
  { kind: 'small', icon: Type, labelKey: 'note.block.small' },
  { kind: 'divider', icon: Minus, labelKey: 'note.block.divider' },
];

export default function NoteBlockInserter({
  onInsert,
  always,
}: {
  onInsert: (kind: EditorBlockKind) => void;
  /** Always visible: this is the case of the end button, which has no gap to hover over. */
  always?: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);

  return (
    <div
      className={`flex justify-center ${always ? '' : 'h-2 opacity-0 transition-opacity hover:opacity-100 focus-within:opacity-100'}`}
    >
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            title={t('note.block.add')}
            aria-label={t('note.block.add')}
            className={`flex items-center gap-1 rounded-full border border-border bg-card px-2 text-2xs text-muted-foreground transition-colors hover:border-primary hover:text-foreground ${
              always ? 'py-1' : '-my-1 py-0.5'
            }`}
          >
            <Plus size={12} /> {always && t('note.block.add')}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-48 p-1">
          <ul>
            {KINDS.map(({ kind, icon: Icon, labelKey }) => (
              <li key={kind}>
                <button
                  type="button"
                  onClick={() => {
                    onInsert(kind);
                    setOpen(false);
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-secondary/60"
                >
                  <Icon size={14} className="text-muted-foreground" />
                  {t(labelKey)}
                </button>
              </li>
            ))}
          </ul>
        </PopoverContent>
      </Popover>
    </div>
  );
}
