// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Eraser, Redo2, Undo2 } from 'lucide-react';
import { IconButton } from '../../../components/ui/icon-button';
import { NumberField } from '../../../components/ui/number-field';
import type { ReviewTool } from '../chrome/tools';
import type { SplatPaintState } from '../splat/paint/useSplatPaint';
import { MAX_STROKE_PX, MIN_STROKE_PX } from '../splat/paint/strokes';
import { useT } from '../../../i18n';

/** Stroke colours of the 3D brush: annotation data, not theme tokens. */
const INK = ['#ff4d4d', '#ffb020', '#3ddc68', '#38b6ff'];

/**
 * Settings of the surface brush and of the stroke eraser, in the options bar: **the same in both
 * spatial viewers** (batch 13). They used to live only in the splat's bar. Since the brush now also
 * serves the 3D model, copying them would have guaranteed divergence.
 *
 * What is displayed depends on the armed tool, not on the media: the brush shows its ink and
 * thickness, the eraser its instruction. Both share the pending stroke stack, hence undo / redo /
 * clear-all, and the count of what will leave with the comment.
 */
export default function PaintOptions({ tool, paint }: { tool: ReviewTool; paint: SplatPaintState }) {
  const t = useT();
  // The eraser has no ink or thickness to set: its instruction is enough, and it names the gesture.
  const erasing = tool.id === 'paint-erase';
  return (
    <>
      {erasing ? (
        <span className="rv-optbar__hint">{t(tool.hintKey)}</span>
      ) : (
        <>
          <span className="rv-row__label">{t('draw.ink')}</span>
          <span className="flex gap-1">
            {INK.map((c) => (
              <button
                key={c}
                type="button"
                title={t('draw.inkColor', { color: c })}
                aria-label={t('draw.inkColor', { color: c })}
                aria-pressed={paint.color === c}
                onClick={() => paint.setColor(c)}
                className={`h-5 w-5 rounded-full border-2 ${
                  paint.color === c ? 'border-foreground' : 'border-transparent'
                }`}
                style={{ backgroundColor: c }}
              />
            ))}
          </span>
          {/* The unit is truthful: thickness is held in screen pixels by `LineMaterial`, the same
              measure as the cursor ring, and does not depend on the distance to the surface. */}
          <NumberField
            label={t('review.thickness')}
            value={paint.width}
            onChange={paint.setWidth}
            min={MIN_STROKE_PX}
            max={MAX_STROKE_PX}
            step={1}
            unit="px"
          />
        </>
      )}
      <span className="rv-rule" />
      <IconButton
        icon={Undo2}
        label={t('review.undoStroke')}
        bordered
        onClick={paint.undoStroke}
        disabled={paint.pendingCount === 0}
      />
      {/* The cancel button had no counterpart: a cancelled stroke was lost. */}
      <IconButton
        icon={Redo2}
        label={t('review.redoStroke')}
        bordered
        onClick={paint.redoStroke}
        disabled={paint.redoCount === 0}
      />
      <IconButton
        icon={Eraser}
        label={t('review.splat.clearStrokes')}
        bordered
        onClick={paint.clearPending}
        disabled={paint.pendingCount === 0}
      />
      <span className="rv-optbar__hint">
        {paint.pendingCount > 0
          ? t('draw.pendingStrokes', { count: paint.pendingCount })
          : t('draw.strokesGoWithComment')}
      </span>
    </>
  );
}
