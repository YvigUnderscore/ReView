// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { RotateCcw } from 'lucide-react';
import { IconButton } from '../../../components/ui/icon-button';
import { NumberField } from '../../../components/ui/number-field';
import OptionsBar, { CommitGroup } from '../chrome/OptionsBar';
import type { ModeId } from '../chrome/modes';
import type { ReviewTool } from '../chrome/tools';
import { DEFAULT_TRANSFORM } from '../reviewTypes';
import type { Model3DThreeState } from '../three/useModel3DThree';
import type { useEditHistory } from '../splat/editor/operations/history';
import PoiOptions from '../poi/PoiOptions';
import type { PoiDraftState } from '../poi/usePoiDraft';
import { useT, type Tr } from '../../../i18n';

const rotations = (t: Tr) =>
  [
    { key: 'pitch', label: 'X°', hint: t('transform.rotationPitch') },
    { key: 'yaw', label: 'Y°', hint: t('transform.rotationYaw') },
    { key: 'roll', label: 'Z°', hint: t('transform.rotationRoll') },
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
  poi,
  presentation,
}: {
  tool: ReviewTool;
  mode: ModeId;
  m: Model3DThreeState;
  history: ReturnType<typeof useEditHistory>;
  dirty: boolean;
  /** Transformation éditable (pré-publication + droits). */
  canEdit: boolean;
  /** Points d'intérêt en préparation — mêmes options que sur le splat. */
  poi: PoiDraftState;
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

      {tool.id === 'pin' && <PoiOptions poi={poi} />}

      {(tool.id === 'cam-move' || tool.id === 'cam-aim') && (
        <span className="rv-optbar__hint">{tr('camera.objectHint')}</span>
      )}

      {/* Les champs chiffrés éditent la transformation de la VERSION. Sans le droit de
          l'enregistrer, ils n'ouvraient qu'une impasse : la valeur changeait à l'écran, aucun
          bouton ne l'écrivait et le badge d'état était masqué. L'outil reste armé — le gizmo
          sert aussi à déplacer un prim de la scène USD, qui a son propre enregistrement. */}
      {transforming && !canEdit && <span className="rv-optbar__hint">{tr(tool.hintKey)}</span>}

      {transforming && canEdit && (
        <>
          {/* La transformation du modèle est une rotation par angles d'Euler et une échelle
              uniforme : les trois gizmos partagent donc les mêmes champs. */}
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
