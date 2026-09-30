// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Trash2 } from 'lucide-react';
import type { EditorBlock } from '../noteEditorModel';
import NoteTextBlock from './NoteTextBlock';
import NoteGalleryBlock from './NoteGalleryBlock';
import NoteImageBlock from './NoteImageBlock';
import { HeadingEditor, ProgressEditor, SmallEditor, TitleEditor } from './NoteSimpleBlocks';
import { useT } from '../../../i18n';

/**
 * Le cadre d'un bloc en édition : ce qui l'entoure, jamais ce qu'il contient.
 *
 * La poignée et la corbeille n'apparaissent qu'au survol — un brief se compose surtout en
 * lisant, et une colonne d'icônes en face de chaque paragraphe donne l'impression d'un
 * formulaire. Le glissement part de la poignée seule : un bloc de texte se sélectionne à la
 * souris, il ne peut pas être aussi la zone qu'on tire.
 */
export default function NoteBlockRow({
  block,
  onChange,
  onRemove,
  onImages,
  onDepthKey,
  busy,
  autoFocus,
}: {
  block: EditorBlock;
  onChange: (patch: Partial<EditorBlock>) => void;
  onRemove: () => void;
  /** Images déposées depuis ce bloc — le parent décide où elles atterrissent. */
  onImages: (files: File[]) => void;
  /** ←/→ sur la poignée : sortir de la section, ou y entrer. */
  onDepthKey?: (key: string) => void;
  busy?: boolean;
  autoFocus?: boolean;
}) {
  const t = useT();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: block.id,
  });

  const content = () => {
    switch (block.kind) {
      case 'heading':
        return <HeadingEditor block={block} onChange={onChange} autoFocus={autoFocus} />;
      case 'title':
        return <TitleEditor block={block} onChange={onChange} autoFocus={autoFocus} />;
      case 'text':
        return (
          <NoteTextBlock
            value={block.source}
            onChange={(source) => onChange({ source })}
            onImages={onImages}
            autoFocus={autoFocus}
          />
        );
      case 'progress':
        return <ProgressEditor block={block} onChange={onChange} autoFocus={autoFocus} />;
      case 'small':
        return <SmallEditor block={block} onChange={onChange} autoFocus={autoFocus} />;
      case 'gallery':
        return <NoteGalleryBlock block={block} onChange={onChange} onFiles={onImages} busy={busy} />;
      case 'image':
        return <NoteImageBlock block={block} onChange={onChange} onFiles={onImages} busy={busy} />;
      case 'divider':
        // Un trait fait deux pixels de haut : sans cette bande autour, il n'y avait rien à
        // survoler pour faire apparaître la poignée, et rien à viser pour le déplacer.
        return (
          <div className="flex h-8 items-center">
            <hr className="w-full border-border" />
          </div>
        );
    }
  };

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`group relative min-h-9 rounded-md pl-7 pr-8 ${isDragging ? 'opacity-50' : ''}`}
    >
      <button
        type="button"
        title={t('note.block.dragHint')}
        aria-label={t('note.block.drag')}
        className="absolute left-0 top-0 flex h-8 w-6 cursor-grab items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-secondary/60 group-hover:opacity-100 focus-visible:opacity-100"
        {...attributes}
        {...listeners}
        onKeyDown={(e) => {
          // Les flèches latérales règlent l'appartenance à la section ; le reste (Espace,
          // flèches verticales) appartient au glisser-déposer au clavier de dnd-kit.
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            e.preventDefault();
            onDepthKey?.(e.key);
            return;
          }
          listeners?.onKeyDown?.(e);
        }}
      >
        <GripVertical size={14} />
      </button>
      {content()}
      <button
        type="button"
        onClick={onRemove}
        title={t('note.block.remove')}
        aria-label={t('note.block.remove')}
        className="absolute right-0 top-0 flex h-8 w-6 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-secondary/60 hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100"
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}
