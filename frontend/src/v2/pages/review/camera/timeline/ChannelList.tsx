// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Diamond } from 'lucide-react';
import type { ChannelId } from '../channels/model';
import { CHANNEL_META, channelColor } from './channelMeta';
import { useT } from '../../../../i18n';

/**
 * Liste des canaux de l'éditeur d'animation (Phase 17) : pastille de couleur (token thème) +
 * libellé, cliquable pour afficher/masquer la F-curve dans le graph editor. Un canal sans clé
 * est grisé. En édition, chaque ligne porte un losange « poser une clé sur **ce** canal au
 * playhead » — la clé complète 8 canaux n'est plus le seul geste.
 */
export default function ChannelList({
  keyedChannels,
  visible,
  onToggle,
  editable,
  onKeyChannel,
}: {
  /** Canaux qui portent au moins une clé (les autres sont inertes). */
  keyedChannels: ReadonlySet<ChannelId>;
  visible: ReadonlySet<ChannelId>;
  onToggle: (id: ChannelId) => void;
  editable?: boolean;
  /** Pose une clé sur ce canal seul, au temps courant (depuis la vue). */
  onKeyChannel?: (id: ChannelId) => void;
}) {
  const t = useT();
  return (
    <div className="flex w-24 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border pr-1 text-[11px] custom-scrollbar">
      {CHANNEL_META.map((c) => {
        const keyed = keyedChannels.has(c.id);
        const on = visible.has(c.id);
        return (
          <div key={c.id} className="group flex items-center">
            <button
              disabled={!keyed}
              onClick={() => onToggle(c.id)}
              className={`flex min-w-0 flex-1 items-center gap-1.5 rounded px-1 py-0.5 text-left transition-colors ${
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
              <span className="truncate">{t(c.labelKey)}</span>
            </button>
            {editable && onKeyChannel && (
              <button
                type="button"
                title={t('camera.keyChannel')}
                aria-label={t('camera.keyChannel')}
                onClick={() => onKeyChannel(c.id)}
                className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-primary focus-visible:opacity-100"
              >
                <Diamond size={9} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
