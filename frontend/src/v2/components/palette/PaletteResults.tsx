// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  Box,
  Film,
  FolderKanban,
  History,
  Image as ImageIcon,
  Layers,
  ListTodo,
  ListVideo,
  MessageSquare,
  Sparkles,
  Users,
  Video,
} from 'lucide-react';
import { projectPath } from '../../lib/slug';
import type { SearchResults } from '../../lib/searchApi';
import type { MediaKind } from '../../types/api';
import { CommandGroup, CommandItem } from '../ui/command';
import { useT } from '../../i18n';

/**
 * Results of the global search, grouped by type.
 *
 * Taken out of `CommandPalette`: ten families do not fit in the same file as the shortcut, the debounce and the quick actions.
 * This component only renders: it knows neither the query nor its loading state.
 *
 * Group labels go through `t()`, except those that ARE production vocabulary (Assets, Versions, Playlists):
 * `scripts/i18n-glossary.json` forbids translating them.
 */

const ICON = 'text-muted-foreground';

/** Icon per media kind: the same as the one on review cards. */
const MEDIA_ICONS: Record<MediaKind, typeof Video> = {
  VIDEO: Video,
  IMAGE: ImageIcon,
  MODEL_3D: Box,
  SPLAT: Sparkles,
};

/** Where a version leads: its most recent media, otherwise the task or asset carrying it. */
function versionTarget(v: SearchResults['versions'][number]): string | null {
  if (v.mediaId !== null) return `/review/${v.mediaId}`;
  if (v.taskId !== null) return `/tasks/${v.taskId}`;
  if (v.assetId !== null) return `/assets/${v.assetId}`;
  return null;
}

export default function PaletteResults({
  results,
  onGo,
}: {
  results: SearchResults;
  onGo: (to: string) => void;
}) {
  const t = useT();
  return (
    <>
      {results.projects.length > 0 && (
        <CommandGroup heading={t('nav.projects')}>
          {results.projects.map((p) => (
            <CommandItem key={p.id} value={`project-${p.id}`} onSelect={() => onGo(projectPath(p))}>
              <FolderKanban size={15} className={ICON} />
              <span className="truncate">{p.name}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      )}

      {results.sequences.length > 0 && (
        <CommandGroup heading={t('nav.sequences')}>
          {results.sequences.map((s) => (
            <CommandItem key={s.id} value={`sequence-${s.id}`} onSelect={() => onGo(`/sequences/${s.id}`)}>
              <Layers size={15} className={ICON} />
              <span className="truncate">{s.code}</span>
              <span className="truncate text-xs text-muted-foreground">{s.name}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      )}

      {results.shots.length > 0 && (
        <CommandGroup heading={t('shots.title')}>
          {results.shots.map((s) => (
            <CommandItem key={s.id} value={`shot-${s.id}`} onSelect={() => onGo(`/shots/${s.id}`)}>
              <Film size={15} className={ICON} />
              <span className="truncate">{s.code}</span>
              <span className="truncate text-xs text-muted-foreground">{s.name}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      )}

      {results.assets.length > 0 && (
        <CommandGroup heading="Assets">
          {results.assets.map((a) => (
            <CommandItem key={a.id} value={`asset-${a.id}`} onSelect={() => onGo(`/assets/${a.id}`)}>
              <Box size={15} className={ICON} />
              <span className="truncate">{a.name}</span>
              <span className="truncate text-xs text-muted-foreground">{a.type}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      )}

      {results.tasks.length > 0 && (
        <CommandGroup heading={t('palette.group.tasks')}>
          {results.tasks.map((task) => (
            <CommandItem key={task.id} value={`task-${task.id}`} onSelect={() => onGo(`/tasks/${task.id}`)}>
              <ListTodo size={15} className={ICON} />
              <span className="truncate">{task.name}</span>
              <span className="truncate text-xs text-muted-foreground">{task.type}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      )}

      {results.versions.length > 0 && (
        <CommandGroup heading="Versions">
          {results.versions.map((v) => {
            const to = versionTarget(v);
            return (
              <CommandItem
                key={v.id}
                value={`version-${v.id}`}
                disabled={to === null}
                onSelect={() => to !== null && onGo(to)}
              >
                <History size={15} className={ICON} />
                <span className="truncate">{v.name}</span>
                <span className="truncate text-xs text-muted-foreground">{v.context}</span>
              </CommandItem>
            );
          })}
        </CommandGroup>
      )}

      {results.media.length > 0 && (
        <CommandGroup heading={t('palette.group.media')}>
          {results.media.map((m) => {
            const Icon = MEDIA_ICONS[m.kind] ?? Video;
            return (
              <CommandItem key={m.id} value={`media-${m.id}`} onSelect={() => onGo(`/review/${m.id}`)}>
                <Icon size={15} className={ICON} />
                <span className="truncate">{m.name}</span>
                <span className="truncate text-xs text-muted-foreground">{m.context}</span>
              </CommandItem>
            );
          })}
        </CommandGroup>
      )}

      {results.playlists.length > 0 && (
        <CommandGroup heading="Playlists">
          {results.playlists.map((p) => (
            <CommandItem key={p.id} value={`playlist-${p.id}`} onSelect={() => onGo(`/playlists/${p.id}`)}>
              <ListVideo size={15} className={ICON} />
              <span className="truncate">{p.name}</span>
              <span className="truncate text-xs text-muted-foreground">{p.projectName}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      )}

      {results.comments.length > 0 && (
        <CommandGroup heading={t('palette.group.comments')}>
          {results.comments.map((c) => (
            <CommandItem
              key={c.id}
              value={`comment-${c.id}`}
              onSelect={() => onGo(`/review/${c.mediaObjectId}?comment=${c.id}`)}
            >
              <MessageSquare size={15} className={ICON} />
              <span className="truncate">{c.excerpt}</span>
              <span className="truncate text-xs text-muted-foreground">
                {`${c.authorName ?? t('comments.anonymous')} · ${c.context}`}
              </span>
            </CommandItem>
          ))}
        </CommandGroup>
      )}

      {results.people.length > 0 && (
        <CommandGroup heading={t('social.people')}>
          {results.people.map((u) => (
            <CommandItem key={u.id} value={`person-${u.id}`} onSelect={() => onGo(`/users/${u.id}`)}>
              <Users size={15} className={ICON} />
              <span className="truncate">{u.name ?? t('palette.person.unnamed')}</span>
              {u.jobTitle !== null && (
                <span className="truncate text-xs text-muted-foreground">{u.jobTitle}</span>
              )}
            </CommandItem>
          ))}
        </CommandGroup>
      )}
    </>
  );
}
