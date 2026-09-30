// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Link, useLocation, useSearchParams } from 'react-router-dom';
import {
  BarChart3,
  BookText,
  Box,
  Clapperboard,
  Film,
  FolderKanban,
  Home,
  KanbanSquare,
  ListVideo,
  PenTool,
  Settings,
  Star,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Project } from '../../types/api';
import { projectPath } from '../../lib/slug';
import { useAuth } from '../../stores/useAuth';
import { useFavorites } from '../../stores/useFavorites';
import ProjectSwitcher from './ProjectSwitcher';
import { useT } from '../../i18n';

/** Entrée de navigation de la barre latérale. */
function SideLink({
  to,
  icon: Icon,
  label,
  active,
  dense,
}: {
  to: string;
  icon: LucideIcon;
  label: string;
  active: boolean;
  /** Entrée de second niveau (section d'un projet) : plus discrète, moins haute. */
  dense?: boolean;
}) {
  return (
    <Link
      to={to}
      className={`flex items-center gap-3 rounded-md text-sm transition-colors ${
        dense ? 'px-3 py-1.5' : 'px-3 py-2'
      } ${
        active
          ? 'bg-secondary text-foreground'
          : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground'
      }`}
    >
      <Icon size={dense ? 15 : 18} className="shrink-0" /> <span className="truncate">{label}</span>
    </Link>
  );
}

/**
 * Corps de la barre latérale (C1).
 *
 * Elle empilait l'accueil, huit projets dépliables en arbre, les reviews, les membres, les
 * réglages, les favoris, les récents, les documents et la documentation — l'essentiel étant
 * noyé, et l'arbre coûtant une requête par séquence ouverte pour n'afficher que des codes.
 *
 * Elle porte désormais trois choses, dans cet ordre : où l'on va (accueil, projets, reviews),
 * ce qu'on regarde (le projet courant et ses sections, en liens directs — plus de déroulants),
 * et ce qu'on a épinglé. Les récents ont rejoint l'accueil, où ils sont à leur place.
 */
export default function SidebarNav({
  projects,
  currentProjectId,
}: {
  projects: Project[];
  currentProjectId: number | null;
}) {
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const user = useAuth((s) => s.user);
  const favorites = useFavorites((s) => s.favorites);
  const t = useT();

  const current = projects.find((p) => p.id === currentProjectId) ?? null;
  const tab = params.get('tab') ?? 'overview';
  const onProjectPage = current !== null && pathname.startsWith('/projects/');
  const to = (suffix: string) => (current ? projectPath(current, suffix) : '/projects');

  // Sections d'un projet : des liens directs vers l'onglet, sans arborescence.
  const sections: { key: string; icon: LucideIcon; label: string; href: string }[] = current
    ? [
        { key: 'sequences', icon: Film, label: t('sequences.title'), href: to('?tab=sequences') },
        { key: 'shots', icon: Clapperboard, label: t('shots.title'), href: to('?tab=shots') },
        { key: 'assets', icon: Box, label: 'Assets', href: to('?tab=assets') },
        { key: 'playlists', icon: ListVideo, label: 'Playlists', href: to('?tab=playlists') },
        {
          key: 'production',
          icon: BarChart3,
          label: t('project.tab.production'),
          href: to('?tab=production'),
        },
        { key: 'kanban', icon: KanbanSquare, label: 'Kanban', href: to('/kanban') },
        { key: 'board', icon: PenTool, label: 'Board', href: to('/board') },
      ]
    : [];

  const sectionActive = (key: string) => {
    if (key === 'kanban') return pathname.endsWith('/kanban');
    if (key === 'board') return pathname.endsWith('/board');
    return onProjectPage && !pathname.endsWith('/kanban') && !pathname.endsWith('/board') && tab === key;
  };

  return (
    <nav className="custom-scrollbar flex-1 space-y-1 overflow-y-auto px-3 pb-3">
      <SideLink to="/" icon={Home} label={t('nav.home')} active={pathname === '/'} />
      <SideLink
        to="/projects"
        icon={FolderKanban}
        label={t('nav.projects')}
        active={pathname === '/projects'}
      />
      <SideLink to="/reviews" icon={Film} label={t('nav.reviews')} active={pathname.startsWith('/reviews')} />

      {/* Le projet qu'on regarde, et lui seul. */}
      <div className="pt-3">
        <ProjectSwitcher projects={projects} currentProjectId={currentProjectId} />
      </div>
      {sections.length > 0 && (
        <div className="space-y-0.5 pt-1">
          {sections.map((section) => (
            <SideLink
              key={section.key}
              to={section.href}
              icon={section.icon}
              label={section.label}
              dense
              active={sectionActive(section.key)}
            />
          ))}
        </div>
      )}

      {/* Favoris : la liste seule, sans titre ni case vide — invisible tant qu'elle l'est. */}
      {favorites.length > 0 && (
        <div className="space-y-0.5 border-t border-border pt-3">
          {favorites.map((f) => (
            <Link
              key={f.id}
              to={f.to}
              className="flex items-center gap-2 rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
              title={f.label}
            >
              <Star size={13} className="shrink-0 text-warning" fill="currentColor" />
              <span className="truncate">{f.label}</span>
            </Link>
          ))}
        </div>
      )}

      <div className="border-t border-border pt-3">
        {user?.role === 'ADMIN' && (
          <SideLink
            to="/admin"
            icon={Settings}
            label={t('nav.settings')}
            active={pathname.startsWith('/admin')}
          />
        )}
        <SideLink
          to="/docs"
          icon={BookText}
          label={t('nav.documentation')}
          active={pathname.startsWith('/docs')}
        />
      </div>
    </nav>
  );
}
