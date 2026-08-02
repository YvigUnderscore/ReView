// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Link, useLocation, useParams } from 'react-router-dom';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { transition as pageTransition } from '../lib/motion';
import {
  Home,
  FolderKanban,
  Film,
  Users,
  Settings,
  ChevronRight,
  Star,
  BookText,
  FileText,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useProjectsQuery } from '../lib/queries';
import { projectPath, parseIdParam } from '../lib/slug';
import { useAuth } from '../stores/useAuth';
import { useFavorites } from '../stores/useFavorites';
import { useProjectContext } from '../stores/useProjectContext';
import UploadWidget from './UploadWidget';
import PendingDrafts from './PendingDrafts';
import SidebarFooter from './SidebarFooter';
import SidebarProjectTree from './SidebarProjectTree';
import SidebarRecents from './SidebarRecents';
import CommandPalette from './CommandPalette';
import NotificationBell from './NotificationBell';
import ShortcutsHelp from './ShortcutsHelp';
import OnboardingTour from './OnboardingTour';
import { useGlobalShortcuts } from '../lib/shortcuts';
import { usePreferences } from '../lib/usePreferences';
import { resolveBindings } from '../lib/shortcutRegistry';
import { syncAccountLocale, useT } from '../i18n';
import { useSocketInvalidation } from '../lib/socketBridge';

const COLLAPSE_KEY = 'sidebar-collapsed';
const ENTITY_PAGE_RE = /^\/(tasks|assets|review)\//;

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

export default function Shell({
  children,
  title,
  breadcrumb,
}: {
  children: ReactNode;
  title?: string;
  breadcrumb?: ReactNode;
}) {
  const user = useAuth((s) => s.user);
  const { pathname } = useLocation();
  const params = useParams();
  const { data } = useProjectsQuery();
  const projects = useMemo(() => (data ?? []).slice(0, 8), [data]);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === '1');
  // Page de review (46.O) : la sidebar démarre repliée pour laisser le viewer occuper l'espace.
  // La dépliér reste possible — choix de session, la préférence globale n'est pas touchée.
  const onReview = pathname.startsWith('/review/');
  const [reviewExpanded, setReviewExpanded] = useState(false);
  const [wasReview, setWasReview] = useState(onReview);
  if (wasReview !== onReview) {
    // Ajusté pendant le rendu (même pattern que useChromeState) : retour à l'état replié à
    // chaque entrée en review, sans effet ni rendu intermédiaire.
    setWasReview(onReview);
    setReviewExpanded(false);
  }
  const sidebarHidden = onReview ? !reviewExpanded : collapsed;
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const favorites = useFavorites((s) => s.favorites);
  const loadFavorites = useFavorites((s) => s.load);
  const t = useT();

  useEffect(() => {
    loadFavorites();
  }, [loadFavorites]);

  const toggleCollapse = () => {
    // En review, la bascule ne vaut que pour la visite : la préférence globale reste intacte.
    if (onReview) {
      setReviewExpanded((v) => !v);
      return;
    }
    setCollapsed((c) => {
      localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1');
      return !c;
    });
  };

  // Projet courant pour la sidebar contextuelle : depuis la route (/projects/:id…)
  // ou, sur les pages d'entité (/tasks, /assets, /review), depuis le contexte
  // résolu par le breadcrumb (useProjectContext).
  const ctxProjectId = useProjectContext((s) => s.projectId);
  const routeId = parseIdParam(params.id);
  const routeProjectId = pathname.startsWith('/projects/') && !Number.isNaN(routeId) ? routeId : null;
  const isEntityPage = ENTITY_PAGE_RE.test(pathname);
  const currentProjectId = routeProjectId ?? (isEntityPage ? ctxProjectId : null);
  const isProjectsRoot = pathname.startsWith('/projects');

  const openHelp = useCallback(() => setHelpOpen(true), []);
  // Raccourcis globaux reconfigurables (42.A2) : touches résolues depuis les préférences.
  const prefsQ = usePreferences();
  // Langue du compte : suivie sur un appareil qui n'a pas encore fait de choix explicite
  // (nouveau poste, session invitée). Un choix local, lui, reste prioritaire.
  const accountLocale = prefsQ.data?.locale;
  useEffect(() => {
    syncAccountLocale(accountLocale);
  }, [accountLocale]);
  const bindings = useMemo(() => resolveBindings(prefsQ.data?.shortcuts), [prefsQ.data?.shortcuts]);
  useGlobalShortcuts({ projectId: currentProjectId, onHelp: openHelp, bindings });
  // Temps réel : room du projet courant → invalidations de cache ciblées (10.E3)
  useSocketInvalidation(currentProjectId);

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      {/* Sidebar (repliable pour gagner de la place ; repliée d'office en review — 46.O) */}
      {!sidebarHidden && (
        <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-card/40">
          <div className="flex items-center justify-between px-4 py-4">
            {/* Logo bannière (masque alpha teinté par le thème — blanc sur sombre, encre sur clair). */}
            <Link to="/" title="Accueil" aria-label="ReView — Accueil">
              <span
                role="img"
                aria-label="ReView"
                className="block h-8 w-[72px] bg-foreground"
                style={{
                  WebkitMaskImage: 'url(/logo_banner.png)',
                  maskImage: 'url(/logo_banner.png)',
                  WebkitMaskRepeat: 'no-repeat',
                  maskRepeat: 'no-repeat',
                  WebkitMaskSize: 'contain',
                  maskSize: 'contain',
                  WebkitMaskPosition: 'left center',
                  maskPosition: 'left center',
                }}
              />
            </Link>
            <button
              onClick={toggleCollapse}
              title="Replier la barre"
              className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              <PanelLeftClose size={18} />
            </button>
          </div>

          <nav className="custom-scrollbar flex-1 space-y-1 overflow-y-auto px-3">
            {/* Entrées fixes de la sidebar hybride (12.D) */}
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

            <SideLink
              to="/reviews"
              icon={Film}
              label={t('nav.reviews')}
              active={pathname.startsWith('/reviews')}
            />

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
                <Star size={13} className="text-warning" /> Favoris
              </div>
              {favorites.length === 0 ? (
                <p className="px-3 py-1 text-xs text-muted-foreground">Aucun favori.</p>
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

          <SidebarFooter />
        </aside>
      )}

      {/* Colonne principale */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4">
          {sidebarHidden && (
            <button
              onClick={toggleCollapse}
              title="Déplier la barre"
              className="rounded p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              <PanelLeftOpen size={18} />
            </button>
          )}
          {breadcrumb ?? (
            <h1 className="truncate text-sm font-medium text-muted-foreground">{title ?? ''}</h1>
          )}
          {/* Recherche permanente (12.D) : champ topbar ouvrant la palette Ctrl+K.
              Bouton stylé en champ — évite la boucle de refocus au retour de la palette. */}
          <button
            onClick={() => setPaletteOpen(true)}
            title="Recherche globale (Ctrl+K)"
            className="ml-auto flex w-full max-w-xs items-center gap-2 rounded-md border border-input bg-secondary/40 px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
          >
            <Search size={15} className="shrink-0" />
            <span className="flex-1 text-left">Rechercher…</span>
            <kbd className="shrink-0 rounded border border-border bg-secondary/60 px-1.5 py-0.5 text-[10px] font-medium">
              Ctrl K
            </kbd>
          </button>
          <NotificationBell />
        </header>
        <motion.main
          key={pathname}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={pageTransition}
          className="custom-scrollbar flex-1 overflow-auto p-6"
        >
          {children}
        </motion.main>
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <ShortcutsHelp open={helpOpen} onOpenChange={setHelpOpen} />
      <OnboardingTour />
      <UploadWidget />
      <PendingDrafts />
    </div>
  );
}
