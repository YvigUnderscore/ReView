// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ReactNode } from 'react';
import { Eraser, Redo2, Undo2 } from 'lucide-react';
import { IconButton } from '../../../components/ui/icon-button';
import { NumberField } from '../../../components/ui/number-field';
import { SegmentedControl } from '../../../components/ui/segmented-control';
import { USER_COLORS } from '../../../lib/userColor';
import OptionsBar from '../chrome/OptionsBar';
import type { ModeId } from '../chrome/modes';
import type { ReviewTool } from '../chrome/tools';
import type { CompareMode } from '../useCompareState';
import type { Annotations } from '../useAnnotations';
import { useT, type MessageKey } from '../../../i18n';

/** Translator passed to the label tables, recomputed on each render. */
type Tr = (key: MessageKey) => string;

const DRAWING = new Set(['draw', 'rect', 'ellipse', 'arrow', 'polygon', 'text']);

/** Inks offered up front: five distinct shades from the user palette. */
const INK = [USER_COLORS[6], USER_COLORS[11], USER_COLORS[2], USER_COLORS[4], USER_COLORS[8]];

const compare_modes = (t: Tr) => [
  { value: 'wipe' as const, label: 'Wipe' },
  { value: 'diff' as const, label: t('review.compare.diff') },
  { value: 'side' as const, label: t('review.compare.sideBySide') },
];

/**
 * Options bar of the flat viewers (video, image): the settings of the single armed tool.
 * Replaces the annotation palette that lived below the comment field. Tools are now in the rail,
 * and only the ink, thickness, opacity and the tool's actions remain here.
 */
export default function MediaOptions({
  tool,
  mode,
  ann,
  compare,
}: {
  tool: ReviewTool;
  mode: ModeId;
  ann: Annotations;
  /** A/B comparison: mode shared with the live session. */
  compare?: {
    mode: CompareMode;
    onMode: (mode: CompareMode) => void;
    hasB: boolean;
    /** A and B settings (`CompareAB`): mounted by the chrome, absent for video. */
    ab?: ReactNode;
  };
}) {
  const t = useT();
  const id = tool.id;
  const drawing = DRAWING.has(id);

  return (
    <OptionsBar tool={tool}>
      {/* The tool's hint fades out in comparison: the line carries the A and B settings there. */}
      {id === 'nav' && mode !== 'compare' && <span className="rv-optbar__hint">{t(tool.hintKey)}</span>}

      {/* Comparison: the settings stay displayed whatever tool is armed. It is the mode that
          compares, not the tool, and the choice of B must be visible. */}
      {mode === 'compare' && compare && (
        <>
          {compare.ab}
          {compare.hasB && (
            <>
              <span className="rv-rule" />
              <SegmentedControl
                label={t('review.compare.mode')}
                items={compare_modes(t)}
                value={compare.mode}
                onChange={compare.onMode}
              />
            </>
          )}
        </>
      )}

      {/* Undo/Redo/Clear follow what is left TO UNDO, not the armed tool: they used to disappear as
          soon as the stroke was disarmed, whereas pasted shapes and references stayed attached to
          the comment. The keyboard (Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z) has covered the same need since
          phase 50; these buttons are its visible counterpart. The ink settings, for their part,
          remain specific to the stroke. */}
      {(drawing ||
        id === 'shape-move' ||
        id === 'erase' ||
        ann.canUndo ||
        ann.canRedo ||
        ann.annot.length > 0) && (
        <>
          {drawing && (
            <>
              <span className="rv-row__label">{t('draw.ink')}</span>
              <span className="flex gap-1">
                {INK.map((c) => (
                  <button
                    key={c}
                    type="button"
                    title={t('draw.inkColor', { color: c })}
                    aria-label={t('draw.inkColor', { color: c })}
                    aria-pressed={ann.color.toLowerCase() === c.toLowerCase()}
                    onClick={() => ann.setColor(c)}
                    className={`h-5 w-5 rounded-full border-2 ${
                      ann.color.toLowerCase() === c.toLowerCase() ? 'border-foreground' : 'border-transparent'
                    }`}
                    style={{ backgroundColor: c }}
                  />
                ))}
                {/* Free colour: the native picker opens outside the page and never covers the
                    media. That is its advantage over the former palette. */}
                <input
                  type="color"
                  value={ann.color}
                  onChange={(e) => ann.setColor(e.target.value)}
                  title={t('draw.otherInk')}
                  aria-label={t('draw.otherInk')}
                  className="h-5 w-5 cursor-pointer rounded-full border border-border bg-transparent p-0"
                />
              </span>
              <NumberField
                label={t('review.thickness')}
                value={ann.penWidth}
                onChange={ann.setPenWidth}
                min={1}
                max={24}
                step={1}
                unit="px"
              />
              <NumberField
                label={t('review.opacity')}
                value={Math.round(ann.alpha * 100)}
                onChange={(v) => ann.setAlpha(v / 100)}
                min={10}
                max={100}
                step={5}
                unit="%"
              />
            </>
          )}
          {(id === 'shape-move' || id === 'erase') && (
            <span className="rv-optbar__hint">{t('draw.pickShape')}</span>
          )}
          <span className="rv-rule" />
          <IconButton
            icon={Undo2}
            label={t('review.undoStroke')}
            bordered
            onClick={ann.undo}
            disabled={!ann.canUndo}
          />
          <IconButton
            icon={Redo2}
            label={t('common.redo')}
            bordered
            onClick={ann.redo}
            disabled={!ann.canRedo}
          />
          <IconButton
            icon={Eraser}
            label={t('draw.clearAll')}
            bordered
            onClick={ann.clear}
            disabled={ann.annot.length === 0}
          />
          <span className="rv-optbar__hint">
            {ann.annot.length > 0
              ? t('draw.shapesAttached', { count: ann.annot.length })
              : t('draw.goesWithComment')}
          </span>
        </>
      )}
    </OptionsBar>
  );
}
