// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { RotateCcw } from 'lucide-react';
import { IconButton } from '@/v2/components/ui/icon-button';
import { NumberField } from '@/v2/components/ui/number-field';
import OptionsBar, { CommitGroup } from '../chrome/OptionsBar';
import type { ModeId } from '../chrome/modes';
import type { ReviewTool } from '../chrome/tools';
import { DEFAULT_TRANSFORM } from '../reviewTypes';
import type { Model3DThreeState } from '../three/useModel3DThree';
import type { useEditHistory } from '../splat/editor/operations/history';
import type { SplatPaintState } from '../splat/paint/useSplatPaint';
import PaintOptions from './PaintOptions';
import PoiOptions from '../poi/PoiOptions';
import type { PoiDraftState } from '../poi/usePoiDraft';
import { useT, type Tr } from '@/v2/i18n';

const rotations = (t: Tr) =>
  [
    { key: 'pitch', label: 'X°', hint: t('transform.rotationPitch') },
    { key: 'yaw', label: 'Y°', hint: t('transform.rotationYaw') },
    { key: 'roll', label: 'Z°', hint: t('transform.rotationRoll') },
  ] as const;

/**
 * Options bar of the 3D viewer: the settings of the single armed tool. Replaces
 * `Model3DTransformBar`, which floated above the scene with its four modes. The modes have become
 * tools in the rail; only their values remain here.
 *
 * The surface brush and its eraser arrive here in batch 13, with **exactly** the splat's settings
 * (`PaintOptions`): a model's "Annotate" mode offered only navigation and the pin, so ink and
 * stroke thickness could not be set.
 */
export default function Model3DOptions({
  tool,
  mode,
  m,
  history,
  dirty,
  canEdit,
  poi,
  paint,
  presentation,
}: {
  tool: ReviewTool;
  mode: ModeId;
  m: Model3DThreeState;
  history: ReturnType<typeof useEditHistory>;
  dirty: boolean;
  /** Editable transform (pre-publication + rights). */
  canEdit: boolean;
  /** Points of interest in preparation: same options as on the splat. */
  poi: PoiDraftState;
  /** Surface brush: same settings as on the splat, same hook. */
  paint: SplatPaintState;
  presentation?: { busy: boolean; onSave: () => void };
}) {
  const tr = useT();
  const t = m.transform;
  const transforming = tool.id === 'translate' || tool.id === 'rotate' || tool.id === 'scale';
  const painting = tool.id === 'paint' || tool.id === 'paint-erase';

  const commit =
    mode === 'clean' && canEdit ? (
      <CommitGroup
        dirty={dirty}
        label={tr('common.save')}
        hint={tr('review.transform.unsaved')}
        onSave={m.saveTransform}
        onUndo={history.undo}
        onRedo={history.redo}
        canUndo={history.canUndo}
        canRedo={history.canRedo}
      />
    ) : mode === 'stage' && presentation ? (
      <CommitGroup
        dirty
        saving={presentation.busy}
        label={tr('common.publish')}
        hint={tr('review.staging.unsaved')}
        onSave={presentation.onSave}
      />
    ) : undefined;

  return (
    <OptionsBar tool={tool} commit={commit}>
      {tool.id === 'nav' && <span className="rv-optbar__hint">{tr(tool.hintKey)}</span>}

      {tool.id === 'pin' && <PoiOptions poi={poi} />}

      {painting && <PaintOptions tool={tool} paint={paint} />}

      {(tool.id === 'cam-move' || tool.id === 'cam-aim') && (
        <span className="rv-optbar__hint">{tr('camera.objectHint')}</span>
      )}

      {/* The numeric fields edit the VERSION's transform. Without the right to save it, they opened a
          dead end: the value changed on screen, no button wrote it, and the status badge was hidden.
          The tool stays armed: the gizmo also moves a prim of the USD scene, which has its own record. */}
      {transforming && !canEdit && <span className="rv-optbar__hint">{tr(tool.hintKey)}</span>}

      {transforming && canEdit && (
        <>
          {/* The model's transform is a rotation by Euler angles and a uniform scale: the three gizmos
              therefore share the same fields. */}
          {rotations(tr).map((r) => (
            <NumberField
              key={r.key}
              label={r.label}
              hint={r.hint}
              value={Math.round(t[r.key])}
              onChange={(v) => m.updateTransform({ [r.key]: v })}
              min={-180}
              max={180}
              step={1}
            />
          ))}
          <NumberField
            label={tr('review.scale')}
            hint={tr('review.uniformScale')}
            value={Number(t.scale.toFixed(2))}
            onChange={(scale) => m.updateTransform({ scale: Math.max(scale, 0.1) })}
            min={0.1}
            max={5}
            step={0.05}
            pixelsPerStep={6}
          />
          <span className="rv-rule" />
          <IconButton
            icon={RotateCcw}
            label={tr('review.resetTransform')}
            bordered
            onClick={() => m.updateTransform(DEFAULT_TRANSFORM)}
          />
        </>
      )}
    </OptionsBar>
  );
}
