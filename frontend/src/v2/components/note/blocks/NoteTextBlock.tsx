// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef, useState } from 'react';
import { Bold, Code, Italic, Link2, List, ListOrdered, Quote } from 'lucide-react';
import { applyMark, type MarkKind } from '../noteEditorMarks';
import { renderNoteHtml } from '../noteRender';
import { isAcceptedNoteImage, useNoteImageResolver } from '../noteImages';
import { useT } from '@/v2/i18n';

/**
 * A paragraph of the note.
 *
 * The block shows **the text as it will be read** until it is edited, and switches to input on click. This avoids having to
 * choose between a WYSIWYG editor, which would force storing something other than markdown and reinventing it with the
 * mouse, and a raw-syntax page that nobody wants to read.
 *
 * While typing, the formatting applies to the selection: via the buttons, or Ctrl+B/I/K. The asterisks remain visible at
 * that precise moment, and at that moment only.
 */

const MARKS: { kind: MarkKind; icon: typeof Bold; labelKey: `note.mark.${MarkKind}` }[] = [
  { kind: 'bold', icon: Bold, labelKey: 'note.mark.bold' },
  { kind: 'italic', icon: Italic, labelKey: 'note.mark.italic' },
  { kind: 'link', icon: Link2, labelKey: 'note.mark.link' },
  { kind: 'bullet', icon: List, labelKey: 'note.mark.bullet' },
  { kind: 'number', icon: ListOrdered, labelKey: 'note.mark.number' },
  { kind: 'quote', icon: Quote, labelKey: 'note.mark.quote' },
  { kind: 'code', icon: Code, labelKey: 'note.mark.code' },
];

export default function NoteTextBlock({
  value,
  onChange,
  onImages,
  autoFocus,
}: {
  value: string;
  onChange: (next: string) => void;
  /** An image pasted into the text becomes an image block, placed just after it. */
  onImages: (files: File[]) => void;
  autoFocus?: boolean;
}) {
  const t = useT();
  const resolve = useNoteImageResolver();
  const field = useRef<HTMLTextAreaElement>(null);
  const [editing, setEditing] = useState(Boolean(autoFocus));

  // Height fits the content: a brief should not have to be read through a four-line window.
  useEffect(() => {
    const node = field.current;
    if (!node || !editing) return;
    node.style.height = 'auto';
    node.style.height = `${node.scrollHeight}px`;
  }, [value, editing]);

  useEffect(() => {
    if (editing) field.current?.focus();
  }, [editing]);

  const mark = (kind: MarkKind) => {
    const node = field.current;
    if (!node) return;
    const out = applyMark(value, node.selectionStart, node.selectionEnd, kind);
    onChange(out.value);
    // The selection is restored after rendering, otherwise React would move it back to the end of the text.
    requestAnimationFrame(() => {
      node.focus();
      node.setSelectionRange(out.selectionStart, out.selectionEnd);
    });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    const key = e.key.toLowerCase();
    const kind = key === 'b' ? 'bold' : key === 'i' ? 'italic' : key === 'k' ? 'link' : null;
    if (!kind) return;
    e.preventDefault();
    mark(kind);
  };

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        aria-label={t('note.text.edit')}
        className="w-full rounded-md px-1 py-0.5 text-left transition-colors hover:bg-secondary/30"
      >
        {value.trim() ? (
          <span
            className="prose-note block text-sm leading-relaxed"
            // Same rendering as the read note: escaped and sanitised by `renderNoteHtml`.
            dangerouslySetInnerHTML={{ __html: renderNoteHtml(value, resolve) }}
          />
        ) : (
          <span className="text-sm text-muted-foreground">{t('note.text.placeholder')}</span>
        )}
      </button>
    );
  }

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-0.5">
        {MARKS.map(({ kind, icon: Icon, labelKey }) => (
          <button
            key={kind}
            type="button"
            title={t(labelKey)}
            aria-label={t(labelKey)}
            // Without this, the click would make the field lose focus, and the selection with it.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => mark(kind)}
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
          >
            <Icon size={13} />
          </button>
        ))}
      </div>
      <textarea
        ref={field}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => setEditing(false)}
        onPaste={(e) => {
          const files = [...e.clipboardData.files].filter(isAcceptedNoteImage);
          if (files.length === 0) return;
          e.preventDefault();
          onImages(files);
        }}
        placeholder={t('note.text.placeholder')}
        aria-label={t('note.text.placeholder')}
        spellCheck
        rows={2}
        className="w-full resize-none rounded-md border border-input bg-background p-2 text-sm leading-relaxed outline-none focus:border-ring"
      />
    </div>
  );
}
