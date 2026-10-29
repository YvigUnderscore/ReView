// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Diamond } from 'lucide-react';
import type { CameraAnimV2, ChannelId, Extrapolation, TangentType } from '../channels/model';
import { CHANNEL_META, channelColor } from './channelMeta';
import ChannelMenu from './ChannelMenu';
import { useT } from '@/v2/i18n';

/**
 * Channel list of the animation editor (Phase 17): color swatch (theme token) + label, clickable
 * to show/hide the F-curve in the graph editor. A channel without keys is grayed out. When
 * editing, each row carries a diamond "set a key on **this** channel at the playhead" — the full
 * 8-channel key is no longer the only gesture.
 *
 * **Right-click on a row** (Phase 50, batch 7): everything that targets the WHOLE curve — tangent
 * profile, pre/post-infinity, selecting its keys, vertical fit (`ChannelMenu`).
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
  /** Channels that carry at least one key (the others are inert). */
  keyedChannels: ReadonlySet<ChannelId>;
  visible: ReadonlySet<ChannelId>;
  onToggle: (id: ChannelId) => void;
  editable?: boolean;
  /** Sets a key on this channel only, at the current time (from the view). */
  onKeyChannel?: (id: ChannelId) => void;
  /** Applies a tangent profile to all keys of the curve. */
  onProfile: (id: ChannelId, type: TangentType) => void;
  /** Sets the channel's extrapolation outside its keys. */
  onInfinity: (id: ChannelId, patch: { pre?: Extrapolation; post?: Extrapolation }) => void;
  onSelectAll: (id: ChannelId) => void;
  /** Fits the value axis to this curve alone. */
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
