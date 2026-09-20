// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Diamond } from 'lucide-react';
import type { CameraAnimV2, ChannelId, Extrapolation, TangentType } from '../channels/model';
import { CHANNEL_META, channelColor } from './channelMeta';
import ChannelMenu from './ChannelMenu';
import { useT } from '../../../../i18n';

/**
 * Liste des canaux de l'éditeur d'animation (Phase 17) : pastille de couleur (token thème) +
 * libellé, cliquable pour afficher/masquer la F-curve dans le graph editor. Un canal sans clé
 * est grisé. En édition, chaque ligne porte un losange « poser une clé sur **ce** canal au
 * playhead » — la clé complète 8 canaux n'est plus le seul geste.
 *
 * **Clic droit sur une ligne** (Phase 50, lot 7) : tout ce qui vise la courbe ENTIÈRE — profil de
 * tangente, pré/post-infinity, sélection de ses clés, recadrage vertical (`ChannelMenu`).
 */
export default function ChannelList({
  anim,
  keyedChannels,
  visible,
  onToggle,
  editable,
  onKeyChannel,
  onProfile,
  onInfinity,
  onSelectAll,
  onFit,
}: {
  anim: CameraAnimV2;
  /** Canaux qui portent au moins une clé (les autres sont inertes). */
  keyedChannels: ReadonlySet<ChannelId>;
  visible: ReadonlySet<ChannelId>;
  onToggle: (id: ChannelId) => void;
  editable?: boolean;
  /** Pose une clé sur ce canal seul, au temps courant (depuis la vue). */
  onKeyChannel?: (id: ChannelId) => void;
  /** Applique un profil de tangente à toutes les clés de la courbe. */
  onProfile: (id: ChannelId, type: TangentType) => void;
  /** Règle l'extrapolation du canal hors de ses clés. */
  onInfinity: (id: ChannelId, patch: { pre?: Extrapolation; post?: Extrapolation }) => void;
  onSelectAll: (id: ChannelId) => void;
  /** Recadre l'axe des valeurs sur cette seule courbe. */
  onFit: (id: ChannelId) => void;
}) {
  const t = useT();
  return (
    <div className="flex w-24 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border pr-1 text-xs custom-scrollbar">
      {CHANNEL_META.map((c) => {
        const keyed = keyedChannels.has(c.id);
        const on = visible.has(c.id);
        const row = (
          <div className="group flex items-center">
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
        const ch = anim.channels[c.id];
        return (
          <ChannelMenu
            key={c.id}
            id={c.id}
            editable={!!editable}
            pre={ch?.pre ?? 'constant'}
            post={ch?.post ?? 'constant'}
            onProfile={onProfile}
            onInfinity={onInfinity}
            onSelectAll={onSelectAll}
            onFit={onFit}
            onKey={(id) => onKeyChannel?.(id)}
          >
            {row}
          </ChannelMenu>
        );
      })}
    </div>
  );
}
