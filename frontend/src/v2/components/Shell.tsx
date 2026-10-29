// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Link, Outlet, useLocation, useParams } from 'react-router-dom';
import { ErrorBoundary } from './ui/error-boundary';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { PanelLeftClose, PanelLeftOpen, Search } from 'lucide-react';
import { useProjectsQuery } from '../lib/queries';
import { parseIdParam } from '../lib/slug';
import { useFavorites } from '../stores/useFavorites';
import { useProjectContext } from '../stores/useProjectContext';
import UploadWidget from './UploadWidget';
import UploadNoteDialog from './UploadNoteDialog';
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
import { usePreferences, useUpdatePreferences } from '../lib/usePreferences';
import { resolveBindings } from '../lib/shortcutRegistry';
import { useIsNarrowViewport } from '../lib/useMediaQuery';
import { useStickyProjectId } from '../lib/stickyProject';
import { resolveCurrentProjectId } from '../lib/currentProject';
import { syncAccountDensity } from '../stores/useDensity';
import { useViewPref } from '../stores/useViewPref';
import { syncAccountLocale, useT } from '../i18n';
import { useSocketInvalidation } from '../lib/socketBridge';

const COLLAPSE_KEY = 'sidebar-collapsed';

/**
 * Application shell (A1): **route layout**, mounted only once for all the
 * authenticated pages, which live in its `<Outlet/>`.
 *
 * Previously each page rendered its own `<Shell>`: changing route unmounted everything,
 * sidebar, messaging, socket subscriptions, palette, and replayed the favorites and
 * presence requests at each click. Pages now project their title via a portal
 * (`PageShell` → `ShellHeaderContext`).
 */
export default function Shell() {
  const { pathname } = useLocation();
  const params = useParams();
  // The whole list, plus the eight most recently modified (C1): the selector must be able to
  // show the current project, however old it is: it used to appear nowhere, not even
  // when one was looking at it.
  // `all`: the sidebar lists the projects in one block; it has no scroll sentinel, so without
  // this a studio of more than a hundred projects would see only a hundred.
  const { data } = useProjectsQuery({ all: true });
  const projects = useMemo(() => data ?? [], [data]);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === '1');
  const narrow = useIsNarrowViewport();
  const t = useT();

  // Two situations force the fallback without touching the global preference: the review
  // (46.O, the viewer takes the space) and the narrow window (A1, 240 px of rail on
  // 1000 px leaves nothing to read). Unfolding remains possible for the duration of the visit.
  const onReview = pathname.startsWith('/review/');
  const forced = onReview || narrow;
  const forceKey = `${String(onReview)}|${String(narrow)}`;
  const [tempExpanded, setTempExpanded] = useState(false);
  const [lastForceKey, setLastForceKey] = useState(forceKey);
  if (lastForceKey !== forceKey) {
    // Adjusted during render (same pattern as useChromeState): no effect, no intermediate render
    // with the sidebar in the wrong state.
    setLastForceKey(forceKey);
    setTempExpanded(false);
  }
  const sidebarHidden = forced ? !tempExpanded : collapsed;

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [headerEl, setHeaderEl] = useState<HTMLElement | null>(null);
  // Stable ref: a callback ref recreated at each render would be called back (null then node)
  // and would re-run the render in a loop.
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

  // Current project: from the route (/projects/:id…) or, on entity pages, from the
  // context resolved by the breadcrumb. The rule lives in `lib/currentProject`, tested: it
  // decides both real-time (`join_project`) and the `g k` / `g b` shortcuts.
  const ctxProjectId = useProjectContext((s) => s.projectId);
  const routeId = parseIdParam(params.id);
  const routeProjectId = pathname.startsWith('/projects/') && !Number.isNaN(routeId) ? routeId : null;
  const currentProjectId = resolveCurrentProjectId(pathname, routeProjectId, ctxProjectId);
  // The bar keeps the open project even on the home page, the project list or the
  // reviews: otherwise its sections would disappear as soon as one left the project.
  const sidebarProjectId = useStickyProjectId(currentProjectId);

  const openHelp = useCallback(() => setHelpOpen(true), []);
  // Reconfigurable global shortcuts (42.A2): keys resolved from the preferences.
  const prefsQ = usePreferences();
  // Account language: followed on a device that has not yet made an explicit choice
  // (new workstation, guest session). A local choice, for its part, keeps priority.
  const accountLocale = prefsQ.data?.locale;
  const accountDensity = prefsQ.data?.density;
  useEffect(() => {
    syncAccountLocale(accountLocale);
  }, [accountLocale]);
  useEffect(() => {
    syncAccountDensity(accountDensity);
  }, [accountDensity]);
  // List view: the account is authoritative, the localStorage mirror only serves the first
  // render. `setPersist` closes the loop: each switch goes back to the server, otherwise
  // the setting would not follow from one workstation to another.
  const accountViewMode = prefsQ.data?.viewMode;
  const accountViewModes = prefsQ.data?.viewModes;
  const updatePrefs = useUpdatePreferences();
  useEffect(() => {
    useViewPref.getState().hydrate({ viewMode: accountViewMode, viewModes: accountViewModes });
  }, [accountViewMode, accountViewModes]);
  useEffect(() => {
    useViewPref.getState().setPersist((patch) => updatePrefs.mutate(patch));
  }, [updatePrefs]);
  const bindings = useMemo(() => resolveBindings(prefsQ.data?.shortcuts), [prefsQ.data?.shortcuts]);
  useGlobalShortcuts({ projectId: currentProjectId, onHelp: openHelp, bindings });
  // Real time: room of the current project, then targeted cache invalidations (10.E3)
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
          <PendingDrafts />
          {/* Suivi des envois, à GAUCHE de la cloche (lot 13) : il flottait en bas à droite,
              par-dessus tout ce que ce coin contient déjà. Ici il vit dans le flux de la
              rangée — il pousse, il ne recouvre pas — et se déplie au clic. */}
          <UploadWidget />
          {/* Notifications à GAUCHE de la recherche (lot 9) : elles occupaient le coin bas
              droit, où le widget d'upload et les toasts se recouvraient mutuellement. Ici
              elles vivent dans le flux de l'en-tête et ne masquent rien. */}
          <NotificationBell />
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
        </header>
        {/* Transition de page en CSS (F3) : le `key={pathname}` remonte le nœud, donc
            l'animation d'entrée rejoue à chaque navigation, exactement comme le faisait
            framer-motion (opacité 0→1, 8 px de montée, 200 ms, même courbe). 38,5 ko gzip
            de moteur d'animation en moins dans le premier chargement. */}
        <main
          key={pathname}
          className="custom-scrollbar flex-1 animate-in overflow-auto fade-in slide-in-from-bottom-2 duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:animate-none"
        >
          {/* La gouttière est portée par PageContainer : sans quoi la variante « flush »
              (review, montage) ne pourrait pas occuper tout l'espace. */}
          <ShellHeaderContext.Provider value={headerEl}>
            {/* Frontière unique des pages différées (D3) : la coquille reste montée
                pendant le téléchargement, seule la zone de contenu attend. */}
            <Suspense
              fallback={<div className="p-6 text-sm text-muted-foreground">{t('common.loading')}</div>}
            >
              {/* Frontière d'erreur au niveau de la page : la coquille — barre latérale,
                  recherche, navigation — survit au plantage d'un écran. Remontée à chaque
                  changement d'URL pour qu'une navigation réarme la frontière. */}
              <ErrorBoundary key={pathname} scope="page">
                <Outlet />
              </ErrorBoundary>
            </Suspense>
          </ShellHeaderContext.Provider>
        </main>
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
      {/* La consigne exigée avant l'envoi : montée ici, elle sert les cinq points de dépôt. */}
      <UploadNoteDialog />
      {/* Conversation ouverte : ancrée au bord de la sidebar, elle survit à la navigation. */}
      <ChatDock sidebarHidden={sidebarHidden} />
    </div>
  );
}
