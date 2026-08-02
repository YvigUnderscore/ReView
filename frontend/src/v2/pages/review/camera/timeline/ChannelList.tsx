// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ChannelId } from '../channels/model';
import { CHANNEL_META, channelColor } from './channelMeta';
import { useT } from '../../../../i18n';

/**
 * Liste des canaux de l'éditeur d'animation (Phase 17) : pastille de couleur (token thème) +
 * libellé, cliquable pour afficher/masquer la F-curve dans le graph editor. Un canal sans clé
 * est grisé. Groupé Position / Cible / Caméra.
 */
export default function ChannelList({
  keyedChannels,
  visible,
  onToggle,
}: {
  /** Canaux qui portent au moins une clé (les autres sont inertes). */
  keyedChannels: ReadonlySet<ChannelId>;
  visible: ReadonlySet<ChannelId>;
  onToggle: (id: ChannelId) => void;
}) {
  const t = useT();
  return (
    <div className="flex w-24 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border pr-1 text-[11px] custom-scrollbar">
      {CHANNEL_META.map((c) => {
        const keyed = keyedChannels.has(c.id);
        const on = visible.has(c.id);
        return (
          <button
            key={c.id}
            disabled={!keyed}
            onClick={() => onToggle(c.id)}
            className={`flex items-center gap-1.5 rounded px-1 py-0.5 text-left transition-colors ${
              keyed ? 'hover:bg-secondary/60' : 'opacity-35'
            } ${on ? 'text-foreground' : 'text-muted-foreground'}`}
          >
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{
                backgroundColor: on ? channelColor(c.colorVar) : 'transparent',
                boxShadow: `inset 0 0 0 1px ${channelColor(c.colorVar)}`,
              }}
            />
            {t(c.labelKey)}
          </button>
        );
      })}
    </div>
  );
}
