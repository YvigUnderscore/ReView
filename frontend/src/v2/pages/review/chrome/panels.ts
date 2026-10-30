// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Axis3d, Download, Info, Sun, Video, type LucideIcon } from 'lucide-react';
import type { MediaKind } from '@/v2/types/api';
import { isSpatialKind } from './modes';
import type { MessageKey } from '@/v2/i18n';

/**
 * Inspector dock — the settings that are **not** tools: what you set once and forget, as opposed
 * to the rail where you arm a gesture. Only one panel open at a time; the dock folds onto its
 * 44 px tab strip.
 */
export type PanelId = 'info' | 'export' | 'camera' | 'light' | 'scene';

export interface ReviewPanel {
  id: PanelId;
  labelKey: MessageKey;
  icon: LucideIcon;
}

const INFO: ReviewPanel = { id: 'info', labelKey: 'panel.info', icon: Info };
const EXPORT: ReviewPanel = { id: 'export', labelKey: 'panel.export', icon: Download };

const SPATIAL_PANELS: ReviewPanel[] = [
  { id: 'camera', labelKey: 'panel.camera', icon: Video },
  // Lighting only makes sense on a model: a splat carries its own baked light.
  { id: 'light', labelKey: 'panel.lighting', icon: Sun },
  { id: 'scene', labelKey: 'panel.scene', icon: Axis3d },
  INFO,
  EXPORT,
];

/**
 * Flat media dock: **Info and Export**, nothing else. The five tabs that used to be there all
 * disappeared in Phase 50, each for the same reason — they repeated what the player already shows,
 * or set at the dock what is better set on the image:
 *
 *   - "Comparison" repeated the header without offering a B version — the choice now lives in the
 *     options bar of the "Compare" mode;
 *   - "Display" announced a frame rate and a playback speed on a still image that do not exist;
 *   - "Playback" only showed the frame rate, already in the Info tab's spec sheet;
 *   - "Guides" duplicated the viewer's right-click, where the four switches live for both flat
 *     media;
 *   - "Image" — the Color panel — offered a display/view, an exposure and a gamma at review time.
 *     A user choice, made with full knowledge of the consequence: color management stays the
 *     **project's** (`ProjectColorSection`), which keeps applying to the image viewer; only the
 *     ad hoc adjustment goes.
 */
const MEDIA_PANELS: ReviewPanel[] = [INFO, EXPORT];

/**
 * Dock panels for a media type, in display order.
 *
 * One difference between the two spatial media: **Lighting** only exists on a model, a cloud
 * carrying its baked light.
 *
 * The **Display** tab left both docks: it set, seventeen centimetres from the media and behind a
 * fold, toggles one tries in bursts while watching it. Its settings did not disappear — they moved
 * to a popover in the viewer's top-left corner, with the same `DisplayPanel` inside (3D in batch 6:
 * `Model3DRenderMenu`; splat in batch 12: `SplatViewerMenus`), so that a setting added tomorrow
 * reaches both or neither.
 */
export function panelsFor(kind: MediaKind): ReviewPanel[] {
  if (!isSpatialKind(kind)) return MEDIA_PANELS;
  return SPATIAL_PANELS.filter((p) => p.id !== 'light' || kind === 'MODEL_3D');
}
