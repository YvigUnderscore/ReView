// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  BarChart3,
  BookText,
  Clapperboard,
  Film,
  FolderKanban,
  Home,
  KanbanSquare,
  PenTool,
  Settings,
  User,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { CommandGroup, CommandItem } from '../ui/command';
import { useAuth } from '../../stores/useAuth';
import { useT } from '../../i18n';
import { matchDestinations } from './paletteMatch';

/**
 * The palette's destinations.
 *
 * There were four of them (Projects, Kanban, Board, Documentation), and they vanished **as soon as the first letter was typed**,
 * which forbade the very gesture of a palette: typing "kanb" to go to the kanban. Neither Home, Reviews, Profile, Settings, nor
 * any tab of the current project appeared, whereas the repository's rule is that every action goes through right-click or
 * through here.
 *
 * The filtering is done here: `Command` is mounted with `shouldFilter={false}` (the entity results come from the server,
 * already ranked), so cmdk sorts nothing by itself.
 */

interface Destination {
  key: string;
  label: string;
  to: string;
  icon: LucideIcon;
}

export default function PaletteGoto({
  query,
  projectId,
  onGo,
}: {
  query: string;
  projectId: number | null;
  onGo: (to: string) => void;
}) {
  const t = useT();
  const role = useAuth((s) => s.user?.role);
  // The "Settings" entry only appears to those who can open it: offering it to everyone would lead to a refused screen.
  const isAdmin = role === 'ADMIN' || role === 'SUPERVISOR';

  const destinations: Destination[] = [
    { key: 'home', label: t('nav.home'), to: '/', icon: Home },
    // `/projects`, not `/`: the entry carries the label "Projects" and led to the home page, the one place where the
    // list of projects cannot be found.
    { key: 'projects', label: t('nav.projects'), to: '/projects', icon: FolderKanban },
    { key: 'reviews', label: t('nav.reviews'), to: '/reviews', icon: Clapperboard },
    ...(projectId !== null
      ? [
          {
            key: 'kanban',
            label: t('palette.goto.kanban'),
            to: `/projects/${projectId}/kanban`,
            icon: KanbanSquare,
          },
          {
            key: 'board',
            label: t('palette.goto.board'),
            to: `/projects/${projectId}/board`,
            icon: PenTool,
          },
          {
            key: 'sequences',
            label: t('sequences.title'),
            to: `/projects/${projectId}?tab=sequences`,
            icon: Film,
          },
          {
            key: 'shots',
            label: t('shots.title'),
            to: `/projects/${projectId}?tab=shots`,
            icon: Clapperboard,
          },
          {
            key: 'production',
            label: t('project.tab.production'),
            to: `/projects/${projectId}?tab=production`,
            icon: BarChart3,
          },
          {
            key: 'members',
            label: t('nav.members'),
            to: `/projects/${projectId}?tab=members`,
            icon: Users,
          },
        ]
      : []),
    { key: 'profile', label: t('profile.title'), to: '/profile', icon: User },
    ...(isAdmin ? [{ key: 'admin', label: t('nav.settings'), to: '/admin', icon: Settings }] : []),
    { key: 'docs', label: t('nav.documentation'), to: '/docs', icon: BookText },
  ];

  const shown = matchDestinations(destinations, query);
  if (shown.length === 0) return null;

  return (
    <CommandGroup heading={t('palette.group.goto')}>
      {shown.map((destination) => (
        <CommandItem
          key={destination.key}
          value={`nav-${destination.key}`}
          onSelect={() => onGo(destination.to)}
        >
          <destination.icon size={15} className="text-muted-foreground" /> {destination.label}
        </CommandItem>
      ))}
    </CommandGroup>
  );
}
