// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { FolderKanban, Layers, Film, Box, ListTodo, KanbanSquare, PenTool, BookText } from 'lucide-react';
import { api } from '../../lib/apiClient';
import { qk } from '../lib/query';
import { projectPath } from '../lib/slug';
import { useProjectContext } from '../stores/useProjectContext';
import type { AssetRef, ProjectRef, SequenceRef, ShotRef, Task } from '../types/api';
import {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from './ui/command';
import { useT } from '../i18n';

/**
 * Palette de commandes globale (10.A2) : Ctrl/Cmd+K → recherche multi-entités
 * via GET /api/search (RBAC serveur), navigation clavier complète (cmdk).
 * Actions rapides (Kanban/Board du projet courant) quand la saisie est vide.
 */

interface SearchResults {
  projects: ProjectRef[];
  sequences: (SequenceRef & { projectId: number })[];
  shots: (ShotRef & { projectId: number })[];
  assets: (AssetRef & { projectId: number })[];
  tasks: (Pick<Task, 'id' | 'name' | 'type'> & { shotId: number | null; assetId: number | null })[];
}

const EMPTY: SearchResults = { projects: [], sequences: [], shots: [], assets: [], tasks: [] };

export default function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const navigate = useNavigate();
  const ctxProjectId = useProjectContext((s) => s.projectId);
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');

  // Raccourci global Ctrl/Cmd+K (prime sur les champs de saisie, comme VS Code/Linear)
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, [open, onOpenChange]);

  // Debounce de la saisie (200 ms) ; la recherche elle-même est une query cachée
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 200);
    return () => clearTimeout(t);
  }, [q]);

  const { data } = useQuery({
    queryKey: qk.search(debounced),
    queryFn: () => api.get<SearchResults>(`/api/search?q=${encodeURIComponent(debounced)}`),
    enabled: open && debounced.length > 0,
    placeholderData: keepPreviousData,
  });

  const go = (to: string) => {
    onOpenChange(false);
    setQ('');
    navigate(to);
  };

  const hasQuery = q.trim().length > 0;
  // Saisie vidée → on ré-affiche les actions rapides, jamais les vieux résultats
  const results = hasQuery ? (data ?? EMPTY) : EMPTY;
  const hasResults = Object.values(results).some((list) => list.length > 0);

  return (
    <CommandDialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setQ('');
      }}
      title={t('palette.title')}
    >
      <Command shouldFilter={false}>
        <CommandInput value={q} onValueChange={setQ} placeholder={t('palette.placeholder')} />
        <CommandList>
          {hasQuery && !hasResults && <CommandEmpty>{t('palette.empty')}</CommandEmpty>}

          {!hasQuery && (
            <CommandGroup heading={t('palette.group.goto')}>
              <CommandItem value="nav-projects" onSelect={() => go('/')}>
                <FolderKanban size={15} className="text-muted-foreground" /> {t('nav.projects')}
              </CommandItem>
              {ctxProjectId !== null && (
                <>
                  <CommandItem value="nav-kanban" onSelect={() => go(`/projects/${ctxProjectId}/kanban`)}>
                    <KanbanSquare size={15} className="text-muted-foreground" /> {t('palette.goto.kanban')}
                  </CommandItem>
                  <CommandItem value="nav-board" onSelect={() => go(`/projects/${ctxProjectId}/board`)}>
                    <PenTool size={15} className="text-muted-foreground" /> {t('palette.goto.board')}
                  </CommandItem>
                </>
              )}
              <CommandItem value="nav-docs" onSelect={() => go('/docs')}>
                <BookText size={15} className="text-muted-foreground" /> {t('nav.documentation')}
              </CommandItem>
            </CommandGroup>
          )}

          {results.projects.length > 0 && (
            <CommandGroup heading={t('nav.projects')}>
              {results.projects.map((p) => (
                <CommandItem key={p.id} value={`project-${p.id}`} onSelect={() => go(projectPath(p))}>
                  <FolderKanban size={15} className="text-muted-foreground" />
                  <span className="truncate">{p.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {results.sequences.length > 0 && (
            <CommandGroup heading="Séquences">
              {results.sequences.map((s) => (
                <CommandItem
                  key={s.id}
                  value={`sequence-${s.id}`}
                  onSelect={() => go(`/projects/${s.projectId}?tab=sequences&seq=${s.id}`)}
                >
                  <Layers size={15} className="text-muted-foreground" />
                  <span className="truncate">{s.code}</span>
                  <span className="truncate text-xs text-muted-foreground">{s.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {results.shots.length > 0 && (
            <CommandGroup heading="Shots">
              {results.shots.map((s) => (
                <CommandItem
                  key={s.id}
                  value={`shot-${s.id}`}
                  onSelect={() => go(`/projects/${s.projectId}?tab=shots&shot=${s.id}`)}
                >
                  <Film size={15} className="text-muted-foreground" />
                  <span className="truncate">{s.code}</span>
                  <span className="truncate text-xs text-muted-foreground">{s.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {results.assets.length > 0 && (
            <CommandGroup heading="Assets">
              {results.assets.map((a) => (
                <CommandItem key={a.id} value={`asset-${a.id}`} onSelect={() => go(`/assets/${a.id}`)}>
                  <Box size={15} className="text-muted-foreground" />
                  <span className="truncate">{a.name}</span>
                  <span className="truncate text-xs text-muted-foreground">{a.type}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {results.tasks.length > 0 && (
            <CommandGroup heading={t('palette.group.tasks')}>
              {results.tasks.map((t) => (
                <CommandItem key={t.id} value={`task-${t.id}`} onSelect={() => go(`/tasks/${t.id}`)}>
                  <ListTodo size={15} className="text-muted-foreground" />
                  <span className="truncate">{t.name}</span>
                  <span className="truncate text-xs text-muted-foreground">{t.type}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
