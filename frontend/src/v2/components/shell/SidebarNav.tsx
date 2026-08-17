// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Link, useLocation } from 'react-router-dom';
import {
  BookText,
  ChevronRight,
  FileText,
  Film,
  FolderKanban,
  Home,
  Settings,
  Star,
  Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Project } from '../../types/api';
import { projectPath } from '../../lib/slug';
import { useAuth } from '../../stores/useAuth';
import { useFavorites } from '../../stores/useFavorites';
import SidebarProjectTree from '../SidebarProjectTree';
import SidebarRecents from '../SidebarRecents';
import { useT } from '../../i18n';

/** Entrée de navigation fixe de la sidebar hybride (12.D). */
function SideLink({
  to,
  icon: Icon,
  label,
  active,
}: {
  to: string;
  icon: LucideIcon;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      to={to}
      className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
        active
          ? 'bg-secondary text-foreground'
          : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground'
      }`}
    >
      <Icon size={18} /> {label}
    </Link>
  );
}

/**
 * Corps de la barre latérale (extrait de `Shell` en A1 : le fichier dépassait le plafond
 * de lint et mêlait layout, navigation et raccourcis). Contenu revu en C1.
 */
export default function SidebarNav({
  projects,
  currentProjectId,
}: {
  projects: Project[];
  currentProjectId: number | null;
}) {
  const { pathname } = useLocation();
  const user = useAuth((s) => s.user);
  const favorites = useFavorites((s) => s.favorites);
  const t = useT();
  const isProjectsRoot = pathname.startsWith('/projects');

  return (
    <nav className="custom-scrollbar flex-1 space-y-1 overflow-y-auto px-3">
      <SideLink to="/" icon={Home} label={t('nav.home')} active={pathname === '/'} />
      <SideLink to="/projects" icon={FolderKanban} label={t('nav.projects')} active={isProjectsRoot} />

      {/* Arbre du projet courant (replié sous Projets) */}
      {projects.length > 0 && (
        <div className="pl-2">
          {projects.map((p) => {
            const isCurrent = p.id === currentProjectId;
            return (
              <div key={p.id}>
                <Link
                  to={projectPath(p)}
                  className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors ${
                    isCurrent ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <ChevronRight size={14} className={isCurrent ? 'text-primary' : ''} />
                  <span className="truncate">{p.name}</span>
                </Link>
                {isCurrent && <SidebarProjectTree key={p.id} projectId={p.id} />}
              </div>
            );
          })}
        </div>
      )}

      <SideLink to="/reviews" icon={Film} label={t('nav.reviews')} active={pathname.startsWith('/reviews')} />

      {user?.role === 'ADMIN' && (
        <>
          <SideLink
            to="/admin/users"
            icon={Users}
            label={t('nav.members')}
            active={pathname.startsWith('/admin/users')}
          />
          <SideLink
            to="/admin"
            icon={Settings}
            label={t('nav.settings')}
            active={pathname.startsWith('/admin') && !pathname.startsWith('/admin/users')}
          />
        </>
      )}

      {/* Favoris */}
      <div className="pt-3">
        <div className="flex items-center gap-2 px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <Star size={13} className="text-warning" /> {t('shell.favorites')}
        </div>
        {favorites.length === 0 ? (
          <p className="px-3 py-1 text-xs text-muted-foreground">{t('shell.favorites.empty')}</p>
        ) : (
          <div className="space-y-0.5">
            {favorites.map((f) => (
              <Link
                key={f.id}
                to={f.to}
                className="flex items-center gap-2 rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
                title={f.label}
              >
                <Star size={13} className="shrink-0 text-warning" fill="currentColor" />
                <span className="truncate">{f.label}</span>
              </Link>
            ))}
          </div>
        )}
      </div>

      <SidebarRecents />

      <div className="pt-3">
        <SideLink
          to="/documents"
          icon={FileText}
          label={t('nav.documents')}
          active={pathname.startsWith('/documents')}
        />
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
