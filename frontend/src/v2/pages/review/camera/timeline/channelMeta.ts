// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ChannelId } from '../channels/model';
import type { MessageKey } from '../../../../i18n';

/** Métadonnées d'affichage d'un canal (libellé court + token de couleur du thème). */
export interface ChannelMeta {
  id: ChannelId;
  labelKey: MessageKey;
  /** Identifiant de regroupement — stable, jamais affiché tel quel. */
  group: 'position' | 'target' | 'camera';
  /** Variable CSS de couleur (token thème) — jamais de couleur brute. */
  colorVar: string;
}

export const CHANNEL_META: readonly ChannelMeta[] = [
  { id: 'px', labelKey: 'channel.posX', group: 'position', colorVar: '--curve-x' },
  { id: 'py', labelKey: 'channel.posY', group: 'position', colorVar: '--curve-y' },
  { id: 'pz', labelKey: 'channel.posZ', group: 'position', colorVar: '--curve-z' },
  { id: 'tx', labelKey: 'channel.targetX', group: 'target', colorVar: '--curve-x' },
  { id: 'ty', labelKey: 'channel.targetY', group: 'target', colorVar: '--curve-y' },
  { id: 'tz', labelKey: 'channel.targetZ', group: 'target', colorVar: '--curve-z' },
  { id: 'fov', labelKey: 'channel.focal', group: 'camera', colorVar: '--curve-fov' },
  { id: 'roll', labelKey: 'channel.tilt', group: 'camera', colorVar: '--curve-roll' },
];

/** Couleur CSS d'un canal à partir de son token (`hsl(var(--curve-x))`). */
export const channelColor = (colorVar: string) => `hsl(var(${colorVar}))`;
