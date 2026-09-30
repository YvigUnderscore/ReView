// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Eraser, Redo2, Undo2 } from 'lucide-react';
import { IconButton } from '../../../components/ui/icon-button';
import { NumberField } from '../../../components/ui/number-field';
import type { ReviewTool } from '../chrome/tools';
import type { SplatPaintState } from '../splat/paint/useSplatPaint';
import { MAX_STROKE_PX, MIN_STROKE_PX } from '../splat/paint/strokes';
import { useT } from '../../../i18n';

/** Couleurs de trait de la brosse 3D — données d'annotation, pas des tokens de thème. */
const INK = ['#ff4d4d', '#ffb020', '#3ddc68', '#38b6ff'];

/**
 * Réglages de la brosse de surface et de la gomme de trait, dans la barre d'options — **les
 * mêmes dans les deux viewers spatiaux** (lot 13). Ils vivaient dans la seule barre du splat ;
 * la brosse servant désormais aussi le modèle 3D, les recopier aurait garanti la divergence.
 *
 * Ce qui s'affiche dépend de l'outil armé, pas du média : la brosse montre son encre et son
 * épaisseur, la gomme sa consigne. Les deux partagent la pile de traits en préparation, donc
 * annuler / rétablir / tout effacer, et le compte de ce qui partira avec le commentaire.
 */
export default function PaintOptions({ tool, paint }: { tool: ReviewTool; paint: SplatPaintState }) {
  const t = useT();
  // La gomme n'a ni encre ni épaisseur à régler : sa consigne suffit, et elle dit le geste.
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
          {/* L'unité dit vrai : l'épaisseur est tenue en pixels d'écran par `LineMaterial` — la
              même mesure que l'anneau du curseur — et ne dépend pas de la distance à la surface. */}
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
      {/* Le bouton d'annulation n'avait pas de réciproque : un trait annulé était perdu. */}
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
