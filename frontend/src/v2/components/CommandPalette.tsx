// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { FolderKanban, KanbanSquare, PenTool, BookText, Clapperboard } from 'lucide-react';
import { qk } from '../lib/query';
import { useReviewCommands } from '../lib/reviewCommands';
import { useProjectContext } from '../stores/useProjectContext';
import { EMPTY_SEARCH, MIN_SEARCH_LENGTH, fetchSearch, hasSearchResults } from '../lib/searchApi';
import {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from './ui/command';
import PaletteActions from './palette/PaletteActions';
import PaletteResults from './palette/PaletteResults';
import { useT } from '../i18n';

/**
 * Palette de commandes globale (10.A2) : Ctrl/Cmd+K → recherche multi-entités
 * via GET /api/search (RBAC serveur), navigation clavier complète (cmdk).
 * Actions rapides (Kanban/Board du projet courant) quand la saisie est vide.
 *
 * Trois précautions pour qu'elle reste instantanée sous la frappe : la saisie est débouncée,
 * la requête précédente est **annulée** dès que la suivante part (`cancelQueries` coupe
 * l'`AbortSignal` que `fetchSearch` transmet à `fetch`), et le serveur borne chaque famille
 * de résultats. Le rendu des dix familles vit dans `palette/PaletteResults`.
 */

const DEBOUNCE_MS = 200;

export default function CommandPalette({
  open,
  onOpenChange,
  onShortcuts,
  onToggleSidebar,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onShortcuts: () => void;
  onToggleSidebar: () => void;
}) {
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const ctxProjectId = useProjectContext((s) => s.projectId);
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const inFlight = useRef('');

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

  // Debounce de la saisie : la recherche en vol pour l'ancienne chaîne est abandonnée, elle
  // n'intéresse plus personne et occupe une connexion.
  useEffect(() => {
    const value = q.trim();
    const timer = setTimeout(() => {
      if (inFlight.current !== '' && inFlight.current !== value) {
        void queryClient.cancelQueries({ queryKey: qk.search(inFlight.current) });
      }
      inFlight.current = value;
      setDebounced(value);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [q, queryClient]);

  const canSearch = debounced.length >= MIN_SEARCH_LENGTH;
  const { data, isFetching } = useQuery({
    queryKey: qk.search(debounced),
    queryFn: ({ signal }) => fetchSearch(debounced, signal),
    enabled: open && canSearch,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });

  const close = () => {
    if (inFlight.current !== '') void queryClient.cancelQueries({ queryKey: qk.search(inFlight.current) });
    inFlight.current = '';
    setQ('');
  };

  const go = (to: string) => {
    onOpenChange(false);
    close();
    void navigate(to);
  };

  const run = (action: () => void) => {
    onOpenChange(false);
    close();
    action();
  };

  const typed = q.trim();
  const hasQuery = typed.length > 0;
  // Saisie vidée → on ré-affiche les actions rapides, jamais les vieux résultats
  const results = canSearch ? (data ?? EMPTY_SEARCH) : EMPTY_SEARCH;

  // Commandes contextuelles du viewer de review monté (B3) — filtrées côté client, la
  // recherche serveur ne les connaît pas.
  const reviewCommands = useReviewCommands((s) => s.commands);
  const matchingReview = hasQuery
    ? reviewCommands.filter((c) => c.label.toLowerCase().includes(typed.toLowerCase()))
    : reviewCommands;

  const hasResults = hasSearchResults(results) || matchingReview.length > 0;

  return (
    <CommandDialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) close();
      }}
      title={t('palette.title')}
    >
      <Command shouldFilter={false}>
        <CommandInput value={q} onValueChange={setQ} placeholder={t('palette.placeholder')} />
        <CommandList>
          {hasQuery && !canSearch && <CommandEmpty>{t('palette.typeMore')}</CommandEmpty>}
          {canSearch && !hasResults && !isFetching && <CommandEmpty>{t('palette.empty')}</CommandEmpty>}

          {matchingReview.length > 0 && (
            <CommandGroup heading={t('palette.group.review')}>
              {matchingReview.map((c) => (
                <CommandItem
                  key={c.id}
                  value={`review-${c.id}`}
                  onSelect={() => {
                    onOpenChange(false);
                    close();
                    c.run();
                  }}
                >
                  <Clapperboard size={15} className="text-muted-foreground" />
                  <span className="truncate">{c.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {!hasQuery && (
            <CommandGroup heading={t('palette.group.goto')}>
              {/* `/projects`, pas `/` : l'entrée porte le libellé « Projets » et menait à
                  l'accueil — le seul endroit où l'on ne trouve pas la liste des projets. */}
              <CommandItem value="nav-projects" onSelect={() => go('/projects')}>
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

          {!hasQuery && (
            <PaletteActions onRun={run} onShortcuts={onShortcuts} onToggleSidebar={onToggleSidebar} />
          )}

          <PaletteResults results={results} onGo={go} />
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
