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

const REVEALS: { value: RevealType; label: string }[] = [
  { value: 'fade', label: 'Fondu' },
  { value: 'sweep', label: 'Balayage' },
  { value: 'dissolve', label: 'Dissolution' },
];

const AXES = [
  { value: 'x' as const, label: 'X' },
  { value: 'y' as const, label: 'Y' },
  { value: 'z' as const, label: 'Z' },
];

const LODS: { value: LodMode; label: string; hint: string }[] = [
  { value: 'off', label: 'Off', hint: 'Aucun niveau de détail — qualité maximale' },
  { value: 'auto', label: 'Auto', hint: 'Active le LOD sous 15 fps, le relâche au-dessus de 25' },
  { value: 'on', label: 'Forcé', hint: 'LOD toujours actif' },
  { value: 'streaming', label: 'Flux', hint: 'Charge les pages du nuage à la demande' },
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
  const reveal = perf.reveal;
  return (
    <>
      <Group title="Repères">
        <Row label="Grille de sol">
          <Switch checked={grid.visible} onCheckedChange={grid.onToggle} label="Grille de sol" />
        </Row>
        {axes && (
          <Row label="Triade d’axes">
            <Switch
              checked={axes.visible}
              onCheckedChange={axes.onToggle}
              label="Triade d’axes dans le coin du viewport"
            />
          </Row>
        )}
        {guides && (
          <Row label="Guides de composition">
            <Switch
              checked={guides.visible}
              onCheckedChange={guides.onToggle}
              label="Tiers, centre, titres sûrs"
            />
          </Row>
        )}
      </Group>

      {section && (
        <Group title="Plan de coupe">
          <Row label="Actif">
            <Switch checked={section.active} onCheckedChange={section.onActive} label="Plan de coupe" />
          </Row>
          {section.active && (
            <>
              <Row label="Axe">
                <SegmentedControl
                  label="Axe du plan de coupe"
                  items={AXES}
                  value={section.axis}
                  onChange={section.onAxis}
                />
              </Row>
              <Row label="Position">
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
              <Row label="Côté inversé">
                <Switch
                  checked={section.flipped}
                  onCheckedChange={section.onFlip}
                  label="Inverser le côté conservé"
                />
              </Row>
            </>
          )}
        </Group>
      )}

      {turntable && (
        <Group title="Turntable">
          <Row label="Rotation auto">
            <Switch
              checked={turntable.active}
              onCheckedChange={turntable.onActive}
              label="Turntable — rotation automatique de la vue"
            />
          </Row>
          {turntable.active && (
            <>
              <Row label="Axe">
                <SegmentedControl
                  label="Axe du turntable"
                  items={AXES}
                  value={turntable.axis}
                  onChange={turntable.onAxis}
                />
              </Row>
              <Row label="Vitesse">
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
            <Row
              label="Niveau de détail"
              stack
              hint="Auto active le LOD sous 15 fps ; Streaming charge les pages à la demande"
            >
              <SegmentedControl
                label="Niveau de détail"
                items={LODS}
                value={perf.lod.mode}
                onChange={perf.lod.onMode}
              />
            </Row>
          )}
          {perf.culling && (
            <Row label="Culling de bord" hint="Désactivé : rien ne disparaît en zoom fort">
              <Switch
                checked={!perf.culling.off}
                onCheckedChange={(v) => perf.culling?.onOff(!v)}
                label="Culling de bord de cadre"
              />
            </Row>
          )}
          {reveal && (
            <>
              <Row label="Apparition à l’ouverture">
                <Switch
                  checked={reveal.config !== null}
                  onCheckedChange={(v) => reveal.onConfig(v ? { type: 'fade', durationMs: 2500 } : null)}
                  label="Effet d’apparition à l’ouverture"
                />
              </Row>
              {reveal.config && (
                <Row label="Effet" stack>
                  <Select
                    value={reveal.config.type}
                    onChange={(e) =>
                      reveal.onConfig({ ...reveal.config!, type: e.target.value as RevealType })
                    }
                    className={DOCK_SELECT}
                  >
                    {REVEALS.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </Select>
                </Row>
              )}
              {reveal.config && (
                <Row label="Durée">
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
                      label="Rejouer l’apparition"
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
