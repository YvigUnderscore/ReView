// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Circle, Grid3x3, Grip, Sparkles, Triangle } from 'lucide-react';
import { Select } from '../../../components/ui/select';
import { SegmentedControl } from '../../../components/ui/segmented-control';
import { Switch } from '../../../components/ui/switch';
import { DOCK_SELECT, Group, Row } from '../chrome/DockGroup';
import type { DebugColorMode } from '../splat/scene/effects/debugColor';
import type { RenderMode } from '../splat/scene/renderModes';
import type { DisplayMode } from '../three/displayModes';
import { useT, type MessageKey } from '../../../i18n';

/** Traducteur passé aux tables de libellés, recalculées à chaque rendu. */
type T = (key: MessageKey) => string;

const splatRender = (t: T) => [
  { value: 'splats' as const, label: t('viewer.mode.splats'), icon: Sparkles },
  { value: 'ellipses' as const, label: t('viewer.mode.ellipses'), icon: Circle },
  { value: 'points' as const, label: t('viewer.mode.points'), icon: Grip },
];

const modelRender = (t: T) => [
  { value: 'shaded' as const, label: t('viewer.mode.shaded'), icon: Circle },
  { value: 'wireframe' as const, label: t('viewer.mode.wireframe'), icon: Grid3x3 },
  { value: 'normals' as const, label: t('viewer.mode.normals'), icon: Triangle },
];

const debugColors = (t: T): { value: DebugColorMode; label: string }[] => [
  { value: 'none', label: t('common.none') },
  { value: 'normal', label: t('viewer.mode.normals') },
  { value: 'depth', label: t('viewer.mode.depth') },
];

/**
 * Panneau Affichage du dock spatial : comment la scène est rendue, et les bascules propres au
 * fichier. Hérite d'`InspectBar`, de `Model3DVariantsBar` et de la partie « debug » des
 * réglages du viewer splat. La colorisation d'inspection reste locale à la session.
 */
export default function DisplayPanel({
  splat,
  realSize,
  model,
  debugMode,
  onDebugMode,
}: {
  /** Rendu du nuage et bascules du splat — présent seulement quand l'éditeur est monté. */
  splat?: {
    mode: RenderMode;
    onMode: (mode: RenderMode) => void;
    baseFlip: boolean;
    onBaseFlip: (v: boolean) => void;
  };
  /** Échelle brute des splats comparés — disponible dès que la version en porte plusieurs. */
  realSize?: { value: boolean; onChange: (v: boolean) => void };
  /** Rendu du maillage et variantes du fichier glTF. */
  model?: {
    mode: DisplayMode;
    onMode: (mode: DisplayMode) => void;
    variants?: { names: string[]; active: string | null; onSelect: (name: string) => void };
    cameras?: { names: string[]; active: string | null; onSelect: (name: string) => void };
    skeleton?: { has: boolean; shown: boolean; onShow: (v: boolean) => void };
  };
  debugMode?: DebugColorMode;
  onDebugMode?: (mode: DebugColorMode) => void;
}) {
  const t = useT();
  return (
    <>
      <Group title={t('viewer.render.title')}>
        {splat && (
          <SegmentedControl
            label={t('viewer.render.cloud')}
            items={splatRender(t)}
            value={splat.mode}
            onChange={splat.onMode}
          />
        )}
        {model && (
          <SegmentedControl
            label={t('viewer.render.model')}
            items={modelRender(t)}
            value={model.mode as ReturnType<typeof modelRender>[number]['value']}
            onChange={model.onMode}
          />
        )}
        {debugMode !== undefined && onDebugMode && (
          <Row label={t('viewer.inspectionTint')} stack hint={t('viewer.inspectionTint.hint')}>
            <Select
              value={debugMode}
              onChange={(e) => onDebugMode(e.target.value as DebugColorMode)}
              className={DOCK_SELECT}
            >
              {debugColors(t).map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </Select>
          </Row>
        )}
      </Group>

      {(splat || realSize) && (
        <Group title={t('viewer.cloud.title')}>
          {realSize && (
            <Row label={t('viewer.realScale')} hint={t('viewer.realScale.hint2')}>
              <Switch
                checked={realSize.value}
                onCheckedChange={realSize.onChange}
                label={t('viewer.realScale.hint')}
              />
            </Row>
          )}
          {splat && (
            <Row label={t('viewer.upAxis')} hint={t('viewer.upAxis.hint2')}>
              <Switch
                checked={splat.baseFlip}
                onCheckedChange={splat.onBaseFlip}
                label={t('viewer.upAxis.hint')}
              />
            </Row>
          )}
        </Group>
      )}

      {/* Beaucoup de fichiers n'ont ni variante ni caméra : pas de section vide dans le dock. */}
      {model && (model.variants?.names.length || model.cameras?.names.length || model.skeleton?.has) && (
        <Group title={t('viewer.variants.title')}>
          {model.variants && model.variants.names.length > 0 && (
            <Row label={t('viewer.materials')} stack>
              <Select
                value={model.variants.active ?? ''}
                onChange={(e) => model.variants?.onSelect(e.target.value)}
                className={DOCK_SELECT}
              >
                {model.variants.names.map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </Select>
            </Row>
          )}
          {model.cameras && model.cameras.names.length > 0 && (
            <Row label={t('viewer.embeddedCameras')} stack>
              <Select
                value={model.cameras.active ?? ''}
                onChange={(e) => model.cameras?.onSelect(e.target.value)}
                className={DOCK_SELECT}
              >
                {model.cameras.names.map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </Select>
            </Row>
          )}
          {model.skeleton?.has && (
            <Row label={t('viewer.skeleton')}>
              <Switch
                checked={model.skeleton.shown}
                onCheckedChange={model.skeleton.onShow}
                label={t('viewer.skeleton.hint')}
              />
            </Row>
          )}
        </Group>
      )}
    </>
  );
}
