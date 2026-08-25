// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useRef, useState } from 'react';
import { ChevronDown, Eye, Images, Minus, Percent, Pencil, Type } from 'lucide-react';
import NoteView from './NoteView';
import NoteTemplateMenu from './NoteTemplateMenu';
import { NOTE_SNIPPETS, type SnippetKind } from './noteMarkdown';
import { Button } from '../ui/button';
import type { NoteScope } from '../../lib/notesApi';
import { useT } from '../../i18n';

/**
 * Écriture d'une fiche.
 *
 * Un éditeur WYSIWYG aurait fallu réinventer le markdown à la souris ; on garde donc le
 * texte, avec une barre qui insère les quatre directives que personne n'a à retenir. Le
 * bouton « Aperçu » remplace la prévisualisation côte à côte : dans un panneau d'en-tête,
 * deux colonnes de trente caractères ne servent ni à écrire ni à lire.
 *
 * L'insertion se fait **à la position du curseur**, pas en fin de texte : ajouter une jauge
 * au milieu d'un brief est le cas courant, et renvoyer l'insertion en bas obligerait à la
 * déplacer à la main chaque fois.
 */

const TOOLS: {
  kind: SnippetKind;
  icon: typeof Type;
  labelKey:
    | 'note.tool.section'
    | 'note.tool.collapsed'
    | 'note.tool.progress'
    | 'note.tool.small'
    | 'note.tool.divider'
    | 'note.tool.refs';
}[] = [
  { kind: 'section', icon: ChevronDown, labelKey: 'note.tool.section' },
  { kind: 'collapsed', icon: ChevronDown, labelKey: 'note.tool.collapsed' },
  { kind: 'progress', icon: Percent, labelKey: 'note.tool.progress' },
  { kind: 'small', icon: Type, labelKey: 'note.tool.small' },
  { kind: 'divider', icon: Minus, labelKey: 'note.tool.divider' },
  { kind: 'refs', icon: Images, labelKey: 'note.tool.refs' },
];

export default function NoteEditor({
  value,
  onChange,
  projectId,
  scope,
  busy,
  onSave,
  onCancel,
}: {
  value: string;
  onChange: (next: string) => void;
  projectId: number;
  /** Périmètre proposé aux modèles — un brief de plan n'en est pas un d'asset. */
  scope: NoteScope;
  busy?: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [preview, setPreview] = useState(false);

  /** Insère à la position du curseur et l'y replace derrière. */
  const insert = (text: string) => {
    const field = ref.current;
    const start = field?.selectionStart ?? value.length;
    const end = field?.selectionEnd ?? value.length;
    const next = value.slice(0, start) + text + value.slice(end);
    onChange(next);
    // Le champ se remet en place après le rendu, sinon React écraserait la sélection.
    requestAnimationFrame(() => {
      field?.focus();
      field?.setSelectionRange(start + text.length, start + text.length);
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1">
        {TOOLS.map(({ kind, icon: Icon, labelKey }) => (
          <button
            key={kind}
            type="button"
            title={t(labelKey)}
            aria-label={t(labelKey)}
            onClick={() => insert(NOTE_SNIPPETS[kind])}
            className="flex h-7 items-center gap-1 rounded border border-border px-1.5 text-2xs text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
          >
            <Icon size={13} /> {t(labelKey)}
          </button>
        ))}
        <span className="ml-auto flex items-center gap-1">
          <NoteTemplateMenu
            projectId={projectId}
            scope={scope}
            body={value}
            onApply={(body) => onChange(body)}
          />
          <button
            type="button"
            onClick={() => setPreview((v) => !v)}
            title={preview ? t('note.edit') : t('note.preview')}
            aria-label={preview ? t('note.edit') : t('note.preview')}
            className="flex h-7 items-center gap-1 rounded border border-border px-1.5 text-2xs text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
          >
            {preview ? <Pencil size={13} /> : <Eye size={13} />}
            {preview ? t('note.edit') : t('note.preview')}
          </button>
        </span>
      </div>

      {preview ? (
        <div className="min-h-40 rounded-md border border-border bg-background p-3">
          <NoteView source={value} />
        </div>
      ) : (
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={t('note.placeholder')}
          spellCheck
          className="h-64 w-full resize-y rounded-md border border-input bg-background p-3 font-mono text-xs leading-relaxed"
        />
      )}

      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button size="sm" disabled={busy} onClick={onSave}>
          {t('common.save')}
        </Button>
      </div>
    </div>
  );
}
