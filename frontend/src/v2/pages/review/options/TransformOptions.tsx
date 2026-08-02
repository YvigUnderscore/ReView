// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { NumberField } from '../../../components/ui/number-field';
import { SegmentedControl } from '../../../components/ui/segmented-control';
import type { SplatTransform } from '../reviewTypes';
import type { GizmoSettings, GizmoTargetKind } from '../viewer/gizmos/gizmoSettings';
import { eulerDegToQuat, quatToEulerDeg } from './transformMath';
import { useT } from '../../../i18n';

const AXES = ['X', 'Y', 'Z'] as const;

const SPACES = [
  { value: 'local' as const, label: 'Local' },
  { value: 'world' as const, label: 'Monde' },
];

/** Le pas d'accrochage se saisit dans le même champ que le reste — 0 vaut « libre ». */
function snapValue(v: number | null): number {
  return v ?? 0;
}

/**
 * Options des gizmos `translate` / `rotate` / `scale` — remplace `TransformFields` et
 * `Model3DTransformBar` qui flottaient sur la scène. La barre ne montre que la grandeur de
 * l'outil armé : position pour déplacer, rotation pour tourner, échelle pour redimensionner.
 * Le two-way est conservé : un drag du gizmo met les champs à jour, une saisie applique.
 */
export default function TransformOptions({
  tool,
  target,
  shape,
  value,
  onCommit,
  gizmo,
}: {
  tool: 'translate' | 'rotate' | 'scale';
  /** Cible du gizmo (« Splat », « Boîte 2 », nom de l'objet). */
  target: string;
  /** Forme du volume actif — contextualise le libellé de l'échelle. */
  shape: 'box' | 'sphere' | null;
  value: SplatTransform;
  onCommit: (t: SplatTransform) => void;
  gizmo: {
    kind: GizmoTargetKind;
    settings: GizmoSettings;
    update: (patch: Partial<GizmoSettings>) => void;
  };
}) {
  const t = useT();
  const s = gizmo.settings;
  const rotationDeg = quatToEulerDeg(value.quaternion);
  const scaleLabel = shape === 'box' ? 'Demi-ext.' : shape === 'sphere' ? 'Demi-axes' : 'Échelle';

  const setVec = (key: 'position' | 'scale', index: number) => (v: number) => {
    const next: [number, number, number] = [...value[key]];
    next[index] = key === 'scale' ? Math.max(v, 0.001) : v;
    onCommit({ ...value, [key]: next });
  };

  return (
    <>
      <span className="rv-optbar__name">{target}</span>
      <SegmentedControl
        label={t('review.gizmo.space')}
        items={SPACES}
        value={s.space}
        onChange={(space) => gizmo.update({ space })}
      />
      <span className="rv-rule" />

      {tool === 'translate' &&
        AXES.map((axis, i) => (
          <NumberField
            key={axis}
            label={axis}
            hint={`Position ${axis}`}
            value={value.position[i]!}
            onChange={setVec('position', i)}
            min={-10000}
            max={10000}
            step={0.001}
            pixelsPerStep={4}
          />
        ))}

      {tool === 'rotate' &&
        AXES.map((axis, i) => (
          <NumberField
            key={axis}
            label={axis}
            hint={`Rotation ${axis}`}
            value={rotationDeg[i]!}
            onChange={(deg) => {
              const next: [number, number, number] = [...rotationDeg];
              next[i] = deg;
              onCommit({ ...value, quaternion: eulerDegToQuat(next) });
            }}
            min={-360}
            max={360}
            step={0.1}
            unit="°"
          />
        ))}

      {tool === 'scale' &&
        AXES.map((axis, i) => (
          <NumberField
            key={axis}
            label={axis}
            hint={`${scaleLabel} ${axis}`}
            value={value.scale[i]!}
            onChange={setVec('scale', i)}
            min={0.001}
            max={10000}
            step={0.001}
            pixelsPerStep={6}
          />
        ))}

      <span className="rv-rule" />
      <NumberField
        label="Pas"
        hint="Accrochage — 0 = libre"
        value={snapValue(
          tool === 'translate' ? s.translationSnap : tool === 'rotate' ? s.rotationSnapDeg : s.scaleSnap,
        )}
        onChange={(v) => {
          const snap = v > 0 ? v : null;
          gizmo.update(
            tool === 'translate'
              ? { translationSnap: snap }
              : tool === 'rotate'
                ? { rotationSnapDeg: snap }
                : { scaleSnap: snap },
          );
        }}
        min={0}
        max={tool === 'rotate' ? 90 : 10}
        step={tool === 'rotate' ? 1 : 0.1}
        pixelsPerStep={6}
      />
      <NumberField
        label={t('review.gizmo.handles')}
        hint={t('review.gizmo.handleSize')}
        value={s.size}
        onChange={(size) => gizmo.update({ size })}
        min={0.4}
        max={2}
        step={0.05}
        pixelsPerStep={6}
      />
    </>
  );
}
