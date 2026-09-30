// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { ChevronDown, ChevronRight } from 'lucide-react';
import { NumberField } from '../../ui/number-field';
import { Input } from '../../ui/input';
import type { HeadingBlock, ProgressEditBlock, SmallEditBlock, TitleBlock } from '../noteEditorModel';
import { useT } from '../../../i18n';

/**
 * Les blocs qui tiennent sur une ligne : un titre de section, une jauge, un sous-texte.
 *
 * Chacun montre à l'édition exactement ce qu'il vaudra à la lecture — une jauge se règle
 * au chiffre et se voit à la barre, un titre replié porte le chevron qu'il aura dans la
 * fiche. C'est ce qui remplace `::progress Animation 60` : la directive existe toujours à
 * l'enregistrement, mais plus personne n'a à l'écrire ni même à la connaître.
 */

export function HeadingEditor({
  block,
  onChange,
  autoFocus,
}: {
  block: HeadingBlock;
  onChange: (patch: Partial<HeadingBlock>) => void;
  autoFocus?: boolean;
}) {
  const t = useT();
  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => onChange({ open: !block.open })}
        title={t('note.heading.collapsed')}
        aria-label={t('note.heading.collapsed')}
        aria-pressed={!block.open}
        className="rounded p-1 text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
      >
        {block.open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
      </button>
      <Input
        autoFocus={autoFocus}
        value={block.title}
        onChange={(e) => onChange({ title: e.target.value })}
        placeholder={t('note.heading.placeholder')}
        aria-label={t('note.heading.placeholder')}
        className="h-8 border-transparent bg-transparent px-1 text-sm font-semibold focus:border-input"
      />
    </div>
  );
}

/**
 * Un intertitre : il découpe la lecture, il ne la replie pas.
 *
 * Distinct de la section pour une raison de lecture, pas de syntaxe : un dépliant demande
 * un geste avant de livrer son contenu, et sur un brief court ce geste ne rapporte rien.
 */
export function TitleEditor({
  block,
  onChange,
  autoFocus,
}: {
  block: TitleBlock;
  onChange: (patch: Partial<TitleBlock>) => void;
  autoFocus?: boolean;
}) {
  const t = useT();
  return (
    <Input
      autoFocus={autoFocus}
      value={block.text}
      onChange={(e) => onChange({ text: e.target.value })}
      placeholder={t('note.title.placeholder')}
      aria-label={t('note.title.placeholder')}
      className="h-8 border-transparent bg-transparent px-1 text-sm font-semibold focus:border-input"
    />
  );
}

export function ProgressEditor({
  block,
  onChange,
  autoFocus,
}: {
  block: ProgressEditBlock;
  onChange: (patch: Partial<ProgressEditBlock>) => void;
  autoFocus?: boolean;
}) {
  const t = useT();
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <Input
          autoFocus={autoFocus}
          value={block.label}
          onChange={(e) => onChange({ label: e.target.value })}
          placeholder={t('note.progress.placeholder')}
          aria-label={t('note.progress.placeholder')}
          className="h-8 flex-1 text-sm"
        />
        <NumberField
          label="%"
          value={block.value}
          onChange={(value) => onChange({ value })}
          min={0}
          max={100}
          step={1}
          unit="%"
          hint={t('note.progress.value')}
        />
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
        <div
          className="h-full rounded-full bg-primary transition-[width]"
          style={{ width: `${block.value}%` }}
        />
      </div>
    </div>
  );
}

export function SmallEditor({
  block,
  onChange,
  autoFocus,
}: {
  block: SmallEditBlock;
  onChange: (patch: Partial<SmallEditBlock>) => void;
  autoFocus?: boolean;
}) {
  const t = useT();
  return (
    <Input
      autoFocus={autoFocus}
      value={block.text}
      onChange={(e) => onChange({ text: e.target.value })}
      placeholder={t('note.small.placeholder')}
      aria-label={t('note.small.placeholder')}
      className="h-8 text-2xs text-muted-foreground"
    />
  );
}
