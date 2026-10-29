// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useRef, useState } from 'react';
import { ImagePlus, Loader2 } from 'lucide-react';
import { NOTE_IMAGE_ACCEPT, isAcceptedNoteImage } from '../noteImages';
import { useT } from '../../../i18n';

/**
 * Bringing an image into a note.
 *
 * Three gestures, because one never remembers which one works: **dropping** a file, **pasting** from the clipboard (the
 * artists' gesture: capture on the keyboard, then Ctrl+V) and **choosing** through the file picker. The third only serves
 * those who have not tried the first two, but it must exist: it is the only one reachable from the keyboard.
 *
 * Files of another type are discarded silently: dropping a folder of renders onto a board is common, and an error per
 * refused file would teach nothing.
 */
export default function NoteImageDrop({
  onFiles,
  busy,
  multiple = true,
  compact,
}: {
  onFiles: (files: File[]) => void;
  busy?: boolean;
  multiple?: boolean;
  /** Reduced version, for a block that already carries an image. */
  compact?: boolean;
}) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const take = (list: FileList | null) => {
    const files = [...(list ?? [])].filter(isAcceptedNoteImage);
    if (files.length > 0) onFiles(multiple ? files : files.slice(0, 1));
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        // This drop is handled: the editor's guard must not add it a second time at the end of the note.
        e.stopPropagation();
        setOver(false);
        take(e.dataTransfer.files);
      }}
      onPaste={(e) => take(e.clipboardData.files)}
      className={`flex flex-col items-center justify-center gap-1.5 rounded-md border border-dashed text-2xs transition-colors ${
        over ? 'border-primary bg-primary/5' : 'border-border bg-secondary/20'
      } ${compact ? 'p-2' : 'p-5'}`}
    >
      <input
        ref={input}
        type="file"
        accept={NOTE_IMAGE_ACCEPT}
        multiple={multiple}
        className="hidden"
        onChange={(e) => {
          take(e.target.files);
          // Without this reset, dropping the same file again would trigger nothing.
          e.target.value = '';
        }}
      />
      {!compact && <span className="text-muted-foreground">{t('note.images.drop')}</span>}
      <button
        type="button"
        disabled={busy}
        onClick={() => input.current?.click()}
        className="flex items-center gap-1.5 rounded border border-border bg-background px-2 py-1 text-foreground transition-colors hover:bg-secondary/60 disabled:opacity-60"
      >
        {busy ? <Loader2 size={13} className="animate-spin" /> : <ImagePlus size={13} />}
        {busy ? t('note.images.uploading') : t('note.images.choose')}
      </button>
    </div>
  );
}
