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
 * Les destinations de la palette.
 *
 * Elles étaient au nombre de quatre — Projets, Kanban, Board, Documentation — et
 * disparaissaient **dès la première lettre tapée**, ce qui interdisait le geste même d'une
 * palette : taper « kanb » pour aller au kanban. Ni Accueil, ni Reviews, ni Profil, ni
 * Réglages, ni aucun onglet du projet courant n'y figuraient, alors que la règle du dépôt
 * veut que toute action passe par le clic droit ou par ici.
 *
 * Le filtrage est fait ici : `Command` est monté avec `shouldFilter={false}` (les résultats
 * d'entités viennent du serveur, déjà classés), donc cmdk ne trie rien de lui-même.
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
  // L'entrée « Réglages » n'apparaît qu'à qui peut l'ouvrir : la proposer à tous mènerait
  // à un écran refusé.
  const isAdmin = role === 'ADMIN' || role === 'SUPERVISOR';

  const destinations: Destination[] = [
    { key: 'home', label: t('nav.home'), to: '/', icon: Home },
    // `/projects`, pas `/` : l'entrée porte le libellé « Projets » et menait à l'accueil —
    // le seul endroit où l'on ne trouve pas la liste des projets.
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
