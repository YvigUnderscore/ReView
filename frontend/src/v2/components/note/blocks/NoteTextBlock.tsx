// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef, useState } from 'react';
import { Bold, Code, Italic, Link2, List, ListOrdered, Quote } from 'lucide-react';
import { applyMark, type MarkKind } from '../noteEditorMarks';
import { renderNoteHtml } from '../noteRender';
import { isAcceptedNoteImage, useNoteImageResolver } from '../noteImages';
import { useT } from '../../../i18n';

/**
 * Un paragraphe de la fiche.
 *
 * Le bloc montre **le texte tel qu'il sera lu** tant qu'on ne l'édite pas, et bascule en
 * saisie au clic. C'est ce qui évite d'avoir à choisir entre un éditeur WYSIWYG — qui
 * imposerait de stocker autre chose que du markdown, et de le réinventer à la souris — et
 * une page de syntaxe brute, que personne n'a envie de lire.
 *
 * Pendant la saisie, la mise en forme se pose à la sélection : les boutons, ou Ctrl+B/I/K.
 * Les astérisques restent visibles à cet instant précis, et à cet instant seulement.
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
  /** Une image collée dans le texte devient un bloc image, posé juste après. */
  onImages: (files: File[]) => void;
  autoFocus?: boolean;
}) {
  const t = useT();
  const resolve = useNoteImageResolver();
  const field = useRef<HTMLTextAreaElement>(null);
  const [editing, setEditing] = useState(Boolean(autoFocus));

  // Hauteur au contenu : un brief n'a pas à se lire dans une fenêtre de quatre lignes.
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
    // La sélection se repose après le rendu, sinon React la ramènerait à la fin du texte.
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
            // Même rendu que la fiche lue — échappé et assaini par `renderNoteHtml`.
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
            // Sans cela, le clic ferait perdre le focus au champ et la sélection avec lui.
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
