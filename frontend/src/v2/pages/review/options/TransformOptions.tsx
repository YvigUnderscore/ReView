// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { NumberField } from '../../../components/ui/number-field';
import { SegmentedControl } from '../../../components/ui/segmented-control';
import type { SplatTransform } from '../reviewTypes';
import type { GizmoSettings, GizmoTargetKind } from '../viewer/gizmos/gizmoSettings';
import { eulerDegToQuat, quatToEulerDeg } from './transformMath';
import { useT, type Tr } from '../../../i18n';

const AXES = ['X', 'Y', 'Z'] as const;

const spaces = (t: Tr) => [
  { value: 'local' as const, label: t('transform.local') },
  { value: 'world' as const, label: t('transform.world') },
];

/** The snap step is entered in the same field as the rest: 0 means "free". */
function snapValue(v: number | null): number {
  return v ?? 0;
}

/**
 * Options of the `translate` / `rotate` / `scale` gizmos. Replaces `TransformFields` and
 * `Model3DTransformBar`, which floated over the scene. The bar only shows the magnitude of the armed
 * tool: position to move, rotation to turn, scale to resize. Two-way binding is kept: a drag of the
 * gizmo updates the fields, and an entry applies.
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
  /** Target of the gizmo ("Splat", "Box 2", object name). */
  target: string;
  /** Shape of the active volume: contextualises the scale label. */
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
  const scaleLabel = shape === 'box' ? 'Demi-ext.' : shape === 'sphere' ? 'Demi-axes' : t('tool.scale');

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
        items={spaces(t)}
        value={s.space}
        onChange={(space) => gizmo.update({ space })}
      />
      <span className="rv-rule" />

      {tool === 'translate' &&
        AXES.map((axis, i) => (
          <NumberField
            key={axis}
            label={axis}
            hint={t('transform.positionAxis', { axis })}
            value={value.position[i]}
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
            hint={t('transform.rotationAxis', { axis })}
            value={rotationDeg[i]}
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
            value={value.scale[i]}
            onChange={setVec('scale', i)}
            min={0.001}
            max={10000}
            step={0.001}
            pixelsPerStep={6}
          />
        ))}

      <span className="rv-rule" />
      <NumberField
        label={t('pipeline.step')}
        hint={t('transform.snapHint')}
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
