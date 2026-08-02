// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ChannelId } from '../channels/model';

/** Métadonnées d'affichage d'un canal (libellé court + token de couleur du thème). */
export interface ChannelMeta {
  id: ChannelId;
  label: string;
  group: 'Position' | 'Cible' | 'Caméra';
  /** Variable CSS de couleur (token thème) — jamais de couleur brute. */
  colorVar: string;
}

export const CHANNEL_META: readonly ChannelMeta[] = [
  { id: 'px', label: 'Pos X', group: 'Position', colorVar: '--curve-x' },
  { id: 'py', label: 'Pos Y', group: 'Position', colorVar: '--curve-y' },
  { id: 'pz', label: 'Pos Z', group: 'Position', colorVar: '--curve-z' },
  { id: 'tx', label: 'Cible X', group: 'Cible', colorVar: '--curve-x' },
  { id: 'ty', label: 'Cible Y', group: 'Cible', colorVar: '--curve-y' },
  { id: 'tz', label: 'Cible Z', group: 'Cible', colorVar: '--curve-z' },
  { id: 'fov', label: 'Focale', group: 'Caméra', colorVar: '--curve-fov' },
  { id: 'roll', label: 'Tilt', group: 'Caméra', colorVar: '--curve-roll' },
];

/** Couleur CSS d'un canal à partir de son token (`hsl(var(--curve-x))`). */
export const channelColor = (colorVar: string) => `hsl(var(${colorVar}))`;
