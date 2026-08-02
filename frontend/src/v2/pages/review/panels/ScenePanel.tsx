// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ReactNode } from 'react';
import { RotateCcw } from 'lucide-react';
import { IconButton } from '../../../components/ui/icon-button';
import { NumberField } from '../../../components/ui/number-field';
import { SegmentedControl } from '../../../components/ui/segmented-control';
import { Select } from '../../../components/ui/select';
import { Switch } from '../../../components/ui/switch';
import { DOCK_SELECT, Group, Row } from '../chrome/DockGroup';
import type { LodMode } from '../splat/scene/lod';
import type { RevealConfig } from '../splat/presentation/usePresentation';
import type { RevealType } from '../splat/scene/effects/reveal';
import { useT, type MessageKey } from '../../../i18n';

/** Traducteur passé aux tables de libellés, recalculées à chaque rendu. */
type Tr = (key: MessageKey) => string;

const reveals = (t: Tr): { value: RevealType; label: string }[] => [
  { value: 'fade', label: t('viewer.reveal.fade') },
  { value: 'sweep', label: t('viewer.reveal.sweep') },
  { value: 'dissolve', label: t('viewer.reveal.dissolve') },
];

const AXES = [
  { value: 'x' as const, label: 'X' },
  { value: 'y' as const, label: 'Y' },
  { value: 'z' as const, label: 'Z' },
];

const lods = (t: Tr): { value: LodMode; label: string; hint: string }[] => [
  { value: 'off', label: 'Off', hint: 'Aucun niveau de détail — qualité maximale' },
  { value: 'auto', label: 'Auto', hint: 'Active le LOD sous 15 fps, le relâche au-dessus de 25' },
  { value: 'on', label: t('viewer.lod.forced'), hint: 'LOD toujours actif' },
  { value: 'streaming', label: t('viewer.lod.stream'), hint: 'Charge les pages du nuage à la demande' },
];

export type SectionAxis = 'x' | 'y' | 'z';

/**
 * Panneau Scène du dock spatial : ce qui entoure le média (repères), ce qui le coupe (plan de
 * coupe, turntable) et ce qui règle son coût de rendu. Réunit `SectionBar`, `TurntableBar`,
 * la grille de sol et la section Performance de l'ancien panneau de réglages du viewer.
 */
export default function ScenePanel({
  grid,
  axes,
  guides,
  section,
  turntable,
  perf,
  scenegraph,
}: {
  grid: { visible: boolean; onToggle: (v: boolean) => void };
  axes?: { visible: boolean; onToggle: (v: boolean) => void };
  guides?: { visible: boolean; onToggle: (v: boolean) => void };
  section?: {
    active: boolean;
    onActive: (v: boolean) => void;
    axis: SectionAxis;
    onAxis: (a: SectionAxis) => void;
    position: number;
    onPosition: (p: number) => void;
    flipped: boolean;
    onFlip: (v: boolean) => void;
  };
  turntable?: {
    active: boolean;
    onActive: (v: boolean) => void;
    axis: SectionAxis;
    onAxis: (a: SectionAxis) => void;
    speed: number;
    onSpeed: (s: number) => void;
  };
  /** Arbre de prims USD (46.C) — absent pour un media sans scenegraph. */
  scenegraph?: ReactNode;
  perf: {
    /** LOD et culling : splat uniquement. */
    lod?: { mode: LodMode; onMode: (m: LodMode) => void };
    culling?: { off: boolean; onOff: (v: boolean) => void };
    reveal?: {
      config: RevealConfig | null;
      onConfig: (c: RevealConfig | null) => void;
      onReplay: () => void;
    };
  };
}) {
  const t = useT();
  const reveal = perf.reveal;
  return (
    <>
      {/* Scenegraph USD (46.C) en tête : c'est la structure de la scene, le reste la decore. */}
      {scenegraph && <Group title="Scenegraph">{scenegraph}</Group>}
      <Group title={t('viewer.guides.title')}>
        <Row label={t('viewer.guides.grid')}>
          <Switch checked={grid.visible} onCheckedChange={grid.onToggle} label={t('viewer.guides.grid')} />
        </Row>
        {axes && (
          <Row label={t('viewer.guides.axes')}>
            <Switch
              checked={axes.visible}
              onCheckedChange={axes.onToggle}
              label={t('viewer.guides.axes.hint')}
            />
          </Row>
        )}
        {guides && (
          <Row label={t('viewer.guides.composition')}>
            <Switch
              checked={guides.visible}
              onCheckedChange={guides.onToggle}
              label={t('viewer.guides.composition.hint')}
            />
          </Row>
        )}
      </Group>

      {section && (
        <Group title={t('viewer.clip.title')}>
          <Row label={t('viewer.clip.enabled')}>
            <Switch
              checked={section.active}
              onCheckedChange={section.onActive}
              label={t('viewer.clip.title')}
            />
          </Row>
          {section.active && (
            <>
              <Row label={t('viewer.clip.axisShort')}>
                <SegmentedControl
                  label={t('viewer.clip.axis')}
                  items={AXES}
                  value={section.axis}
                  onChange={section.onAxis}
                />
              </Row>
              <Row label={t('viewer.clip.position')}>
                <NumberField
                  label="pos"
                  value={section.position}
                  onChange={section.onPosition}
                  min={-100}
                  max={100}
                  step={0.5}
                  pixelsPerStep={4}
                />
              </Row>
              <Row label={t('viewer.clip.flip')}>
                <Switch
                  checked={section.flipped}
                  onCheckedChange={section.onFlip}
                  label={t('viewer.clip.flip.hint')}
                />
              </Row>
            </>
          )}
        </Group>
      )}

      {turntable && (
        <Group title="Turntable">
          <Row label={t('viewer.turntable')}>
            <Switch
              checked={turntable.active}
              onCheckedChange={turntable.onActive}
              label={t('viewer.turntable.hint')}
            />
          </Row>
          {turntable.active && (
            <>
              <Row label={t('viewer.clip.axisShort')}>
                <SegmentedControl
                  label={t('viewer.turntable.axis')}
                  items={AXES}
                  value={turntable.axis}
                  onChange={turntable.onAxis}
                />
              </Row>
              <Row label={t('viewer.speed')}>
                <NumberField
                  label="°/s"
                  value={turntable.speed}
                  onChange={turntable.onSpeed}
                  min={1}
                  max={180}
                  step={1}
                />
              </Row>
            </>
          )}
        </Group>
      )}

      {/* Le modèle 3D n'a ni LOD ni effet d'apparition : pas de section vide dans son dock. */}
      {(perf.lod || perf.culling || reveal) && (
        <Group title="Performance">
          {perf.lod && (
            <Row label={t('viewer.lod')} stack hint={t('viewer.lod.hint')}>
              <SegmentedControl
                label={t('viewer.lod')}
                items={lods(t)}
                value={perf.lod.mode}
                onChange={perf.lod.onMode}
              />
            </Row>
          )}
          {perf.culling && (
            <Row label={t('viewer.culling.short')} hint={t('viewer.culling.hint')}>
              <Switch
                checked={!perf.culling.off}
                onCheckedChange={(v) => perf.culling?.onOff(!v)}
                label={t('viewer.culling')}
              />
            </Row>
          )}
          {reveal && (
            <>
              <Row label={t('viewer.reveal')}>
                <Switch
                  checked={reveal.config !== null}
                  onCheckedChange={(v) => reveal.onConfig(v ? { type: 'fade', durationMs: 2500 } : null)}
                  label={t('viewer.reveal.hint')}
                />
              </Row>
              {reveal.config && (
                <Row label={t('viewer.reveal.effect')} stack>
                  <Select
                    value={reveal.config.type}
                    onChange={(e) =>
                      reveal.onConfig({ ...reveal.config!, type: e.target.value as RevealType })
                    }
                    className={DOCK_SELECT}
                  >
                    {reveals(t).map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </Select>
                </Row>
              )}
              {reveal.config && (
                <Row label={t('viewer.duration')}>
                  <span className="flex gap-1">
                    <NumberField
                      label="s"
                      value={Number((reveal.config.durationMs / 1000).toFixed(1))}
                      onChange={(s) =>
                        reveal.onConfig({ ...reveal.config!, durationMs: Math.round(s * 1000) })
                      }
                      min={0.2}
                      max={10}
                      step={0.1}
                      pixelsPerStep={6}
                    />
                    <IconButton
                      icon={RotateCcw}
                      label={t('viewer.reveal.replay')}
                      bordered
                      onClick={reveal.onReplay}
                    />
                  </span>
                </Row>
              )}
            </>
          )}
        </Group>
      )}
    </>
  );
}
