// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { AlignCenter, AlignLeft, AlignRight, StretchHorizontal } from 'lucide-react';
import { SegmentedControl } from '../../ui/segmented-control';
import { NumberField } from '../../ui/number-field';
import { Input } from '../../ui/input';
import { IMAGE_WIDTH, isNoteImageKey, type ImageAlign } from '../noteMarkdown';
import { useNoteImageResolver } from '../noteImages';
import type { ImageEditBlock } from '../noteEditorModel';
import NoteImageDrop from './NoteImageDrop';
import { useT } from '../../../i18n';

/**
 * Une image posée seule dans le fil.
 *
 * Elle se règle comme on la lira : pleine largeur pour un plan de référence, centrée et
 * réduite pour une vignette, à gauche ou à droite quand le texte doit couler autour. La
 * largeur est en pourcentage de la colonne, jamais en pixels — un brief se lit aussi sur
 * un écran deux fois plus étroit que celui où il a été écrit.
 */
export default function NoteImageBlock({
  block,
  onChange,
  onFiles,
  busy,
}: {
  block: ImageEditBlock;
  onChange: (patch: Partial<ImageEditBlock>) => void;
  onFiles: (files: File[]) => void;
  busy?: boolean;
}) {
  const t = useT();
  const resolve = useNoteImageResolver();
  const src = resolve(block.src) ?? (isNoteImageKey(block.src) ? null : block.src);

  const aligns: { value: ImageAlign; label: string; icon: typeof AlignLeft }[] = [
    { value: 'full', label: t('note.image.alignFull'), icon: StretchHorizontal },
    { value: 'center', label: t('note.image.alignCenter'), icon: AlignCenter },
    { value: 'left', label: t('note.image.alignLeft'), icon: AlignLeft },
    { value: 'right', label: t('note.image.alignRight'), icon: AlignRight },
  ];

  if (!block.src) {
    return <NoteImageDrop onFiles={onFiles} busy={busy} multiple={false} />;
  }

  return (
    <div className="space-y-2">
      <div
        className={
          block.align === 'center' || block.align === 'full'
            ? 'flex justify-center'
            : block.align === 'left'
              ? 'flex justify-start'
              : 'flex justify-end'
        }
      >
        {src ? (
          <img
            src={src}
            alt={block.alt}
            loading="lazy"
            decoding="async"
            style={{ width: `${block.width}%` }}
            className="rounded-md border border-border"
          />
        ) : (
          <span
            className="block h-32 rounded-md border border-dashed border-border bg-secondary/30"
            style={{ width: `${block.width}%` }}
            aria-hidden
          />
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl
          items={aligns.map((a) => ({ value: a.value, label: a.label, icon: a.icon, hint: a.label }))}
          value={block.align}
          onChange={(align) => onChange({ align })}
          iconOnly
          label={t('note.image.align')}
        />
        <NumberField
          label={t('note.image.width')}
          value={block.width}
          onChange={(width) => onChange({ width })}
          min={IMAGE_WIDTH.min}
          max={IMAGE_WIDTH.max}
          step={5}
          unit="%"
        />
        <Input
          value={block.alt}
          onChange={(e) => onChange({ alt: e.target.value })}
          placeholder={t('note.image.altPlaceholder')}
          aria-label={t('note.image.alt')}
          className="h-8 min-w-40 flex-1 text-xs"
        />
      </div>
    </div>
  );
}
