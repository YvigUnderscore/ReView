// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { Clapperboard } from 'lucide-react';
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
import PaletteGoto from './palette/PaletteGoto';
import PaletteResults from './palette/PaletteResults';
import PaletteSurfaces from './palette/PaletteSurfaces';
import { hasSurfaceHits, useSurfaceSearch } from './palette/useSurfaceSearch';
import { useT } from '../i18n';

/**
 * Global command palette (10.A2): Ctrl/Cmd+K → multi-entity search
 * via GET /api/search (server-side RBAC), full keyboard navigation (cmdk).
 * Quick actions (Kanban/Board of the current project) when the input is empty.
 *
 * Three precautions so that it stays instant while typing: the input is debounced,
 * the previous request is **cancelled** as soon as the next one leaves (`cancelQueries` cuts
 * the `AbortSignal` that `fetchSearch` passes to `fetch`), and the server caps each family
 * of results. The rendering of the families served by the API lives in `palette/PaletteResults`;
 * the documentation and the settings, which are screens rather than data, are searched in
 * memory (`palette/useSurfaceSearch`).
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
  /**
   * Active item of the list, held by us rather than by cmdk.
   *
   * `shouldFilter={false}` disables cmdk's filtering pass, and it is that pass which,
   * in cmdk's own logic, reselects the first item. Result: after typing, the quick actions
   * were unmounted and the results mounted, but the active value remained that of an item
   * that had disappeared. **No element was selected anymore**, so Enter did nothing: one
   * had first to press ↓. A palette whose first Enter keystroke is lost
   * is not a palette.
   */
  const [active, setActive] = useState('');
  const inFlight = useRef('');

  // Global Ctrl/Cmd+K shortcut (takes precedence over input fields, like VS Code/Linear)
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

  // Input debounce: the in-flight search for the old string is abandoned; it
  // interests no one anymore and occupies a connection.
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

  // The query changed: the result set will change too. We clear the selection so that
  // cmdk takes over again and designates the first item as soon as it is mounted.
  //
  // Adjusted DURING render rather than in an effect (an accepted React pattern, already used by
  // `Shell` when the media type changes): in an effect, the list would have been displayed for a
  // whole render without selection, exactly the window in which the user presses Enter.
  const [lastQuery, setLastQuery] = useState(debounced);
  if (lastQuery !== debounced) {
    setLastQuery(debounced);
    setActive('');
  }

  const close = () => {
    if (inFlight.current !== '') void queryClient.cancelQueries({ queryKey: qk.search(inFlight.current) });
    inFlight.current = '';
    setQ('');
    setActive('');
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
  // Input cleared → we redisplay the quick actions, never the old results
  const results = canSearch ? (data ?? EMPTY_SEARCH) : EMPTY_SEARCH;

  // Contextual commands of the mounted review viewer (B3), filtered client-side, since
  // the server search does not know them.
  const reviewCommands = useReviewCommands((s) => s.commands);
  const matchingReview = hasQuery
    ? reviewCommands.filter((c) => c.label.toLowerCase().includes(typed.toLowerCase()))
    : reviewCommands;

  // Documentation and settings: two families of **screens**, computed in memory (the doc
  // corpus and the settings index live client-side). They follow typing without waiting for
  // the debounce, like the destinations and quick actions: nothing goes out on the network.
  const surfaces = useSurfaceSearch(typed, typed.length >= MIN_SEARCH_LENGTH);

  const hasResults = hasSearchResults(results) || matchingReview.length > 0 || hasSurfaceHits(surfaces);

  return (
    <CommandDialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) close();
      }}
      title={t('palette.title')}
    >
      <Command shouldFilter={false} value={active} onValueChange={setActive}>
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

          <PaletteGoto query={typed} projectId={ctxProjectId} onGo={go} />

          <PaletteActions
            query={typed}
            onRun={run}
            onShortcuts={onShortcuts}
            onToggleSidebar={onToggleSidebar}
          />

          <PaletteResults results={results} onGo={go} />

          <PaletteSurfaces hits={surfaces} onGo={go} />
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
