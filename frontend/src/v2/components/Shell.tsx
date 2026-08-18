// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Link, Outlet, useLocation, useParams } from 'react-router-dom';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { transition as pageTransition } from '../lib/motion';
import { PanelLeftClose, PanelLeftOpen, Search } from 'lucide-react';
import { useProjectsQuery } from '../lib/queries';
import { parseIdParam } from '../lib/slug';
import { useFavorites } from '../stores/useFavorites';
import { useProjectContext } from '../stores/useProjectContext';
import UploadWidget from './UploadWidget';
import PendingDrafts from './PendingDrafts';
import SidebarFooter from './SidebarFooter';
import SidebarNav from './shell/SidebarNav';
import { ShellHeaderContext } from './shell/shellHeaderContext';
import ChatDock from './chat/ChatDock';
import CommandPalette from './CommandPalette';
import ContextMenuGuard from './ContextMenuGuard';
import NotificationBell from './NotificationBell';
import ShortcutsHelp from './ShortcutsHelp';
import OnboardingTour from './OnboardingTour';
import { useGlobalShortcuts } from '../lib/shortcuts';
import { usePreferences } from '../lib/usePreferences';
import { resolveBindings } from '../lib/shortcutRegistry';
import { useIsNarrowViewport } from '../lib/useMediaQuery';
import { useStickyProjectId } from '../lib/stickyProject';
import { syncAccountDensity } from '../stores/useDensity';
import { syncAccountLocale, useT } from '../i18n';
import { useSocketInvalidation } from '../lib/socketBridge';

const COLLAPSE_KEY = 'sidebar-collapsed';
const ENTITY_PAGE_RE = /^\/(tasks|assets|review)\//;

/**
 * Coquille de l'application (A1) : **route layout**, montée une seule fois pour toutes les
 * pages authentifiées, qui vivent dans son `<Outlet/>`.
 *
 * Auparavant chaque page rendait son propre `<Shell>` : changer de route démontait tout —
 * sidebar, messagerie, abonnements socket, palette — et rejouait les requêtes de favoris et
 * de présence à chaque clic. Les pages projettent désormais leur titre par portail
 * (`PageShell` → `ShellHeaderContext`).
 */
export default function Shell() {
  const { pathname } = useLocation();
  const params = useParams();
  // La liste entière, plus les huit derniers modifiés (C1) : le sélecteur doit pouvoir
  // montrer le projet courant, fût-il ancien — il n'apparaissait nulle part auparavant,
  // pas même quand on était en train de le regarder.
  const { data } = useProjectsQuery();
  const projects = useMemo(() => data ?? [], [data]);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === '1');
  const narrow = useIsNarrowViewport();
  const t = useT();

  // Deux situations imposent le repli sans toucher à la préférence globale : la review
  // (46.O — le viewer prend l'espace) et la fenêtre étroite (A1 — 240 px de rail sur
  // 1000 px ne laissent pas de quoi lire). Dépliér reste possible, le temps de la visite.
  const onReview = pathname.startsWith('/review/');
  const forced = onReview || narrow;
  const forceKey = `${String(onReview)}|${String(narrow)}`;
  const [tempExpanded, setTempExpanded] = useState(false);
  const [lastForceKey, setLastForceKey] = useState(forceKey);
  if (lastForceKey !== forceKey) {
    // Ajusté pendant le rendu (même motif que useChromeState) : pas d'effet, pas de rendu
    // intermédiaire avec la sidebar dans le mauvais état.
    setLastForceKey(forceKey);
    setTempExpanded(false);
  }
  const sidebarHidden = forced ? !tempExpanded : collapsed;

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [headerEl, setHeaderEl] = useState<HTMLElement | null>(null);
  // Ref stable : une callback ref recréée à chaque rendu serait rappelée (null puis nœud)
  // et relancerait le rendu en boucle.
  const headerRef = useCallback((node: HTMLDivElement | null) => setHeaderEl(node), []);
  const loadFavorites = useFavorites((s) => s.load);

  useEffect(() => {
    void loadFavorites();
  }, [loadFavorites]);

  const toggleCollapse = () => {
    if (forced) {
      setTempExpanded((v) => !v);
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
  // La barre garde le projet ouvert même sur l'accueil, la liste des projets ou les
  // reviews : sans cela ses sections disparaissaient dès qu'on quittait le projet.
  const sidebarProjectId = useStickyProjectId(currentProjectId);

  const openHelp = useCallback(() => setHelpOpen(true), []);
  // Raccourcis globaux reconfigurables (42.A2) : touches résolues depuis les préférences.
  const prefsQ = usePreferences();
  // Langue du compte : suivie sur un appareil qui n'a pas encore fait de choix explicite
  // (nouveau poste, session invitée). Un choix local, lui, reste prioritaire.
  const accountLocale = prefsQ.data?.locale;
  const accountDensity = prefsQ.data?.density;
  useEffect(() => {
    syncAccountLocale(accountLocale);
  }, [accountLocale]);
  useEffect(() => {
    syncAccountDensity(accountDensity);
  }, [accountDensity]);
  const bindings = useMemo(() => resolveBindings(prefsQ.data?.shortcuts), [prefsQ.data?.shortcuts]);
  useGlobalShortcuts({ projectId: currentProjectId, onHelp: openHelp, bindings });
  // Temps réel : room du projet courant → invalidations de cache ciblées (10.E3)
  useSocketInvalidation(currentProjectId);

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      {/* En fenêtre étroite la sidebar se superpose au contenu : la comprimer ne laisserait
          que ~660 px utiles, ce qui casse toutes les grilles. */}
      {!sidebarHidden && narrow && (
        <div
          className="fixed inset-0 z-30 bg-background/70"
          onClick={() => setTempExpanded(false)}
          aria-hidden
        />
      )}
      {!sidebarHidden && (
        <aside
          className={
            narrow
              ? 'fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-border bg-card shadow-xl'
              : 'flex w-60 shrink-0 flex-col border-r border-border bg-card/40'
          }
        >
          <div className="flex items-center justify-between px-4 py-4">
            {/* Logo bannière (masque alpha teinté par le thème — blanc sur sombre, encre sur clair). */}
            <Link to="/" title={t('nav.home')} aria-label={t('shell.home')}>
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
              title={t('shell.collapse')}
              className="rounded p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              <PanelLeftClose size={18} />
            </button>
          </div>

          <SidebarNav projects={projects} currentProjectId={sidebarProjectId} />
          <SidebarFooter />
        </aside>
      )}

      {/* Colonne principale */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4">
          {sidebarHidden && (
            <button
              onClick={toggleCollapse}
              title={t('shell.expand')}
              className="shrink-0 rounded p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              <PanelLeftOpen size={18} />
            </button>
          )}
          {/* Titre / fil d'Ariane projeté par la page courante (PageShell). */}
          <div ref={headerRef} className="flex min-w-0 flex-1 items-center gap-3" />
          {/* Recherche permanente (12.D) : ouvre la palette Ctrl+K. Réduite à une icône en
              fenêtre étroite — un champ de 20rem y mangerait le fil d'Ariane. */}
          {narrow ? (
            <button
              onClick={() => setPaletteOpen(true)}
              title={t('shell.search')}
              aria-label={t('shell.search')}
              className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <Search size={18} />
            </button>
          ) : (
            <button
              onClick={() => setPaletteOpen(true)}
              title={t('shell.search')}
              className="flex w-full max-w-xs shrink-0 items-center gap-2 rounded-md border border-input bg-secondary/40 px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
            >
              <Search size={15} className="shrink-0" />
              <span className="flex-1 text-left">{t('shell.search.placeholder')}</span>
              <kbd className="shrink-0 rounded border border-border bg-secondary/60 px-1.5 py-0.5 text-2xs font-medium">
                Ctrl K
              </kbd>
            </button>
          )}
          <NotificationBell />
        </header>
        <motion.main
          key={pathname}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={pageTransition}
          className="custom-scrollbar flex-1 overflow-auto"
        >
          {/* La gouttière est portée par PageContainer : sans quoi la variante « flush »
              (review, montage) ne pourrait pas occuper tout l'espace. */}
          <ShellHeaderContext.Provider value={headerEl}>
            <Outlet />
          </ShellHeaderContext.Provider>
        </motion.main>
      </div>

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onShortcuts={openHelp}
        onToggleSidebar={toggleCollapse}
      />
      <ShortcutsHelp open={helpOpen} onOpenChange={setHelpOpen} />
      {/* Le clic droit ne sert que les menus métier : ailleurs, rien ne s'ouvre et le menu
          du navigateur reste bloqué (A3). */}
      <ContextMenuGuard />
      <OnboardingTour />
      <UploadWidget />
      <PendingDrafts />
      {/* Conversation ouverte : ancrée au bord de la sidebar, elle survit à la navigation. */}
      <ChatDock sidebarHidden={sidebarHidden} />
    </div>
  );
}
