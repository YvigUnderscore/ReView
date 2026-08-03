// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { MapPin, RotateCcw } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { IconButton } from '../../../components/ui/icon-button';
import { NumberField } from '../../../components/ui/number-field';
import OptionsBar, { CommitGroup } from '../chrome/OptionsBar';
import type { ModeId } from '../chrome/modes';
import type { ReviewTool } from '../chrome/tools';
import { DEFAULT_TRANSFORM } from '../reviewTypes';
import type { Model3DThreeState } from '../three/useModel3DThree';
import type { useEditHistory } from '../splat/editor/operations/history';
import { useT } from '../../../i18n';

const ROTATIONS = [
  { key: 'pitch', label: 'X°', hint: 'Rotation X (pitch)' },
  { key: 'yaw', label: 'Y°', hint: 'Rotation Y (yaw)' },
  { key: 'roll', label: 'Z°', hint: 'Rotation Z (roll)' },
] as const;

/**
 * Barre d'options du viewer 3D : les paramètres du seul outil armé. Remplace
 * `Model3DTransformBar`, qui flottait au-dessus de la scène avec ses quatre modes — les modes
 * sont devenus des outils du rail, il ne reste ici que leurs valeurs.
 */
export default function Model3DOptions({
  tool,
  mode,
  m,
  history,
  dirty,
  canEdit,
  onPlaceHotspot,
  presentation,
}: {
  tool: ReviewTool;
  mode: ModeId;
  m: Model3DThreeState;
  history: ReturnType<typeof useEditHistory>;
  dirty: boolean;
  /** Transformation éditable (pré-publication + droits). */
  canEdit: boolean;
  onPlaceHotspot: () => void;
  presentation?: { busy: boolean; onSave: () => void };
}) {
  const tr = useT();
  const t = m.transform;
  const transforming = tool.id === 'translate' || tool.id === 'rotate' || tool.id === 'scale';

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

      {tool.id === 'pin' && (
        <>
          <span className="rv-optbar__hint">{tr('review.markerHint')}</span>
          <span className="rv-rule" />
          <Button size="sm" variant="outline" onClick={onPlaceHotspot}>
            <MapPin size={13} />
            {tr('review.markerPlace')}
          </Button>
        </>
      )}

      {(tool.id === 'cam-move' || tool.id === 'cam-aim') && (
        <span className="rv-optbar__hint">{tr('camera.objectHint')}</span>
      )}

      {transforming && (
        <>
          {/* La transformation du modèle est une rotation par angles d'Euler et une échelle
              uniforme : les trois gizmos partagent donc les mêmes champs. */}
          {ROTATIONS.map((r) => (
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
