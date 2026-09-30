// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useNavigate } from 'react-router-dom';
import { ArrowDown, ArrowUp, ListVideo, Play, X } from 'lucide-react';
import { toast } from 'sonner';
import ReviewDecisionBadge from '../../components/ReviewDecisionBadge';
import EmptyState from '../../components/ui/empty-state';
import EntityContextMenu from '../../components/ui/entity-menu';
import { itemPath } from '../review/playlistNav';
import type { MenuEntry } from '../../lib/menuSpec';
import type { PlaylistDetail, PlaylistItemEntry } from '../../types/api';
import { useT } from '../../i18n';

/**
 * Contenu ordonné de la playlist, à droite du catalogue (C5).
 *
 * Réordonner échouait dès qu'une seule version de la playlist passait à la corbeille :
 * l'écran renvoyait la liste qu'il affiche, le serveur exigeait la liste complète. Le
 * serveur accepte désormais un ordre partiel — c'est corrigé côté service.
 */
export default function PlaylistContent({
  playlist,
  canEdit,
  onReorder,
  onRemove,
  busy,
}: {
  playlist: PlaylistDetail;
  canEdit: boolean;
  onReorder: (itemIds: number[]) => void;
  onRemove: (itemId: number) => void;
  busy: boolean;
}) {
  const t = useT();
  const navigate = useNavigate();
  const items = playlist.items;

  const move = (index: number, delta: -1 | 1) => {
    const ids = items.map((it) => it.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    onReorder(ids);
  };

  const open = (item: PlaylistItemEntry) => {
    const path = itemPath(item, playlist.id);
    if (path) void navigate(path);
    else toast.error(t('task.noPlayableMedia'));
  };

  const menuFor = (item: PlaylistItemEntry, index: number): MenuEntry[] => [
    { id: 'open', label: t('playlist.openInReview'), icon: <Play size={14} />, onSelect: () => open(item) },
    ...(canEdit
      ? [
          {
            id: 'up',
            label: t('common.moveUp'),
            icon: <ArrowUp size={14} />,
            disabled: index === 0,
            onSelect: () => move(index, -1),
          },
          {
            id: 'down',
            label: t('common.moveDown'),
            icon: <ArrowDown size={14} />,
            disabled: index === items.length - 1,
            onSelect: () => move(index, 1),
          },
          {
            id: 'remove',
            label: t('playlist.remove'),
            icon: <X size={14} />,
            onSelect: () => onRemove(item.id),
          },
        ]
      : []),
  ];

  if (items.length === 0) {
    return (
      <section className="flex min-h-0 flex-col rounded-lg border border-border">
        <EmptyState
          compact
          icon={ListVideo}
          title={t('playlist.empty')}
          description={canEdit ? t('playlist.emptyHint') : undefined}
        />
      </section>
    );
  }

  return (
    <section className="flex min-h-0 flex-col rounded-lg border border-border">
      <ol className="min-h-0 flex-1 overflow-y-auto">
        {items.map((item, index) => (
          <EntityContextMenu key={item.id} entries={menuFor(item, index)}>
            <li className="border-b border-border/50 last:border-b-0">
              {/* L'interaction vit sur un bouton interne : le <li> reste non interactif (a11y). */}
              <button
                type="button"
                onClick={() => open(item)}
                className="flex w-full items-center gap-3 px-3 py-1.5 text-left text-sm hover:bg-secondary/50"
              >
                <span className="w-5 shrink-0 text-right font-mono text-xs text-muted-foreground">
                  {index + 1}
                </span>
                {item.media?.thumbnailUrl ? (
                  <img
                    src={item.media.thumbnailUrl}
                    alt=""
                    loading="lazy"
                    className="h-8 w-14 shrink-0 rounded object-cover"
                  />
                ) : (
                  <span className="h-8 w-14 shrink-0 rounded bg-secondary" />
                )}
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium">{item.version.location || item.media?.originalName}</span>
                  <span className="ml-2 text-xs text-muted-foreground">{item.version.name}</span>
                </span>
                {item.version.reviewStatus && <ReviewDecisionBadge status={item.version.reviewStatus} />}
                {canEdit && (
                  <span
                    role="button"
                    tabIndex={-1}
                    aria-hidden
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!busy) onRemove(item.id);
                    }}
                    className="shrink-0 rounded p-1 text-muted-foreground hover:bg-secondary hover:text-destructive"
                  >
                    <X size={14} />
                  </span>
                )}
              </button>
            </li>
          </EntityContextMenu>
        ))}
      </ol>
    </section>
  );
}
