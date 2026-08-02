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

const SPLAT_RENDER = [
  { value: 'splats' as const, label: 'Splats', icon: Sparkles },
  { value: 'ellipses' as const, label: 'Ellipses', icon: Circle },
  { value: 'points' as const, label: 'Points', icon: Grip },
];

const MODEL_RENDER = [
  { value: 'shaded' as const, label: 'Ombré', icon: Circle },
  { value: 'wireframe' as const, label: 'Filaire', icon: Grid3x3 },
  { value: 'normals' as const, label: 'Normales', icon: Triangle },
];

const DEBUG_COLORS: { value: DebugColorMode; label: string }[] = [
  { value: 'none', label: 'Aucune' },
  { value: 'normal', label: 'Normales' },
  { value: 'depth', label: 'Profondeur' },
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
  return (
    <>
      <Group title="Rendu">
        {splat && (
          <SegmentedControl
            label="Mode de rendu du nuage"
            items={SPLAT_RENDER}
            value={splat.mode}
            onChange={splat.onMode}
          />
        )}
        {model && (
          <SegmentedControl
            label="Mode de rendu du modèle"
            items={MODEL_RENDER}
            value={model.mode as (typeof MODEL_RENDER)[number]['value']}
            onChange={model.onMode}
          />
        )}
        {debugMode !== undefined && onDebugMode && (
          <Row label="Colorisation d’inspection" stack hint="Locale à votre session">
            <Select
              value={debugMode}
              onChange={(e) => onDebugMode(e.target.value as DebugColorMode)}
              className={DOCK_SELECT}
            >
              {DEBUG_COLORS.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </Select>
          </Row>
        )}
      </Group>

      {(splat || realSize) && (
        <Group title="Nuage">
          {realSize && (
            <Row label="Taille réelle" hint="Sans unification des échelles par bounding box">
              <Switch
                checked={realSize.value}
                onCheckedChange={realSize.onChange}
                label="Afficher les splats à leur échelle brute"
              />
            </Row>
          )}
          {splat && (
            <Row label="Orientation redressée" hint="Convention Y-down redressée à l’import">
              <Switch
                checked={splat.baseFlip}
                onCheckedChange={splat.onBaseFlip}
                label="Redresser l’orientation à l’import"
              />
            </Row>
          )}
        </Group>
      )}

      {/* Beaucoup de fichiers n'ont ni variante ni caméra : pas de section vide dans le dock. */}
      {model && (model.variants?.names.length || model.cameras?.names.length || model.skeleton?.has) && (
        <Group title="Variantes du fichier">
          {model.variants && model.variants.names.length > 0 && (
            <Row label="Matériaux" stack>
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
            <Row label="Caméras embarquées" stack>
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
            <Row label="Squelette du rig">
              <Switch
                checked={model.skeleton.shown}
                onCheckedChange={model.skeleton.onShow}
                label="Afficher le squelette (debug skinning)"
              />
            </Row>
          )}
        </Group>
      )}
    </>
  );
}
