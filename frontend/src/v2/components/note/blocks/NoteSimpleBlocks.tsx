// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { ChevronDown, ChevronRight } from 'lucide-react';
import { NumberField } from '../../ui/number-field';
import { Input } from '../../ui/input';
import type { HeadingBlock, ProgressEditBlock, SmallEditBlock, TitleBlock } from '../noteEditorModel';
import { useT } from '@/v2/i18n';

/**
 * Blocks that fit on one line: a section title, a gauge, a sub-text.
 *
 * Each one shows, while editing, exactly what it will be when read: a gauge is set by its figure and seen on its bar, and a
 * collapsed title carries the chevron it will have in the note. This replaces `::progress Animation 60`: the directive still
 * exists when saving, but nobody has to write it or even know it.
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
 * A subheading: it divides the reading, it does not collapse it.
 *
 * Distinct from the section for a reading reason, not a syntactic one: a dropdown asks for a gesture before revealing its
 * content, and on a short brief that gesture brings nothing.
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
