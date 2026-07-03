import { Link, useLocation, useParams } from 'react-router-dom';
import { useEffect, useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { FolderKanban, Shield, Clapperboard, ChevronRight, Star, BookText, PanelLeftClose, PanelLeftOpen, Search } from 'lucide-react';
import { api } from '../../lib/apiClient';
import { useAuth } from '../stores/useAuth';
import { useFavorites } from '../stores/useFavorites';
import { useProjectContext } from '../stores/useProjectContext';
import UploadWidget from './UploadWidget';
import PendingDrafts from './PendingDrafts';
import SidebarFooter from './SidebarFooter';
import SidebarProjectTree from './SidebarProjectTree';
import SidebarRecents from './SidebarRecents';
import CommandPalette from './CommandPalette';

interface ProjectLink { id: number; name: string; }

const COLLAPSE_KEY = 'sidebar-collapsed';

export default function Shell({ children, title, breadcrumb }: { children: ReactNode; title?: string; breadcrumb?: ReactNode }) {
  const user = useAuth((s) => s.user);
  const { pathname } = useLocation();
  const params = useParams();
  const [projects, setProjects] = useState<ProjectLink[]>([]);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === '1');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const favorites = useFavorites((s) => s.favorites);
  const loadFavorites = useFavorites((s) => s.load);

  useEffect(() => {
    api.get<{ projects: ProjectLink[] }>('/api/projects').then((d) => setProjects(d.projects.slice(0, 8))).catch(() => undefined);
    loadFavorites();
  }, [loadFavorites]);

  const toggleCollapse = () => setCollapsed((c) => { localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1'); return !c; });

  // Projet courant pour la sidebar contextuelle : depuis la route (/projects/:id…)
  // ou, sur les pages d'entité (/tasks, /assets, /review), depuis le contexte
  // résolu par le breadcrumb (useProjectContext).
  const ctxProjectId = useProjectContext((s) => s.projectId);
  const routeProjectId = pathname.startsWith('/projects/') ? Number(params.id) : null;
  const isEntityPage = /^\/(tasks|assets|review)\//.test(pathname);
  const currentProjectId = routeProjectId ?? (isEntityPage ? ctxProjectId : null);
  const isProjectsRoot = pathname === '/' || pathname.startsWith('/projects');

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      {/* Sidebar (repliable pour gagner de la place) */}
      {!collapsed && (
        <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-card/40">
          <div className="flex items-center justify-between px-4 py-4">
            <Link to="/" className="flex items-center gap-2 text-lg font-semibold tracking-tight">
              <Clapperboard size={20} className="text-primary" />
              ReView
            </Link>
            <button onClick={toggleCollapse} title="Replier la barre" className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground">
              <PanelLeftClose size={18} />
            </button>
          </div>

          <nav className="custom-scrollbar flex-1 space-y-1 overflow-y-auto px-3">
            <Link
              to="/"
              className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                isProjectsRoot ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground'
              }`}
            >
              <FolderKanban size={18} /> Projets
            </Link>

            {/* Raccourcis projets */}
            {projects.length > 0 && (
              <div className="pl-2 pt-1">
                {projects.map((p) => {
                  const isCurrent = p.id === currentProjectId;
                  return (
                    <div key={p.id}>
                      <Link
                        to={`/projects/${p.id}`}
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

            {/* Favoris */}
            <div className="pt-3">
              <div className="flex items-center gap-2 px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Star size={13} className="text-amber-400" /> Favoris
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
                      <Star size={13} className="shrink-0 text-amber-400" fill="currentColor" />
                      <span className="truncate">{f.label}</span>
                    </Link>
                  ))}
                </div>
              )}
            </div>

            <SidebarRecents />

            <Link
              to="/docs"
              className={`mt-3 flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                pathname.startsWith('/docs') ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground'
              }`}
            >
              <BookText size={18} /> Documentation
            </Link>

            {user?.role === 'ADMIN' && (
              <Link
                to="/admin"
                className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                  pathname.startsWith('/admin') ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground'
                }`}
              >
                <Shield size={18} /> Administration
              </Link>
            )}
          </nav>

          <SidebarFooter />
        </aside>
      )}

      {/* Colonne principale */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4">
          {collapsed && (
            <button onClick={toggleCollapse} title="Déplier la barre" className="rounded p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground">
              <PanelLeftOpen size={18} />
            </button>
          )}
          {breadcrumb ?? <h1 className="truncate text-sm font-medium text-muted-foreground">{title ?? ''}</h1>}
          <button
            onClick={() => setPaletteOpen(true)}
            title="Recherche globale (Ctrl+K)"
            className="ml-auto flex shrink-0 items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
          >
            <Search size={14} /> Rechercher…
            <kbd className="rounded border border-border bg-secondary/60 px-1.5 py-0.5 text-[10px] font-medium">Ctrl K</kbd>
          </button>
        </header>
        <motion.main
          key={pathname}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="custom-scrollbar flex-1 overflow-auto p-6"
        >
          {children}
        </motion.main>
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <UploadWidget />
      <PendingDrafts />
    </div>
  );
}
