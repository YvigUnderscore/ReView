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

/** Navigation entry of the sidebar. */
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
  /** Second-level entry (a section of a project): more discreet, less tall. */
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
 * Body of the sidebar (C1).
 *
 * It used to stack the home page, eight expandable projects in a tree, the reviews, the members, the settings, the favourites,
 * the recents, the documents and the documentation: the essentials were drowned, and the tree cost one request per opened
 * sequence just to display codes.
 *
 * It now carries three things, in this order: where one goes (home, projects, reviews), what one is looking at (the current
 * project and its sections, as direct links, no more dropdowns), and what has been pinned. The recents have joined the home
 * page, where they belong.
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

  // Sections of a project: direct links to the tab, with no tree.
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

      {/* The project one is looking at, and it alone. */}
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

      {/* Favourites: the list alone, with no title or empty box, invisible as long as it is empty. */}
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
