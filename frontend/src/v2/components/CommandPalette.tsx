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
 * Palette de commandes globale (10.A2) : Ctrl/Cmd+K → recherche multi-entités
 * via GET /api/search (RBAC serveur), navigation clavier complète (cmdk).
 * Actions rapides (Kanban/Board du projet courant) quand la saisie est vide.
 *
 * Trois précautions pour qu'elle reste instantanée sous la frappe : la saisie est débouncée,
 * la requête précédente est **annulée** dès que la suivante part (`cancelQueries` coupe
 * l'`AbortSignal` que `fetchSearch` transmet à `fetch`), et le serveur borne chaque famille
 * de résultats. Le rendu des familles servies par l'API vit dans `palette/PaletteResults` ;
 * la documentation et les réglages, qui sont des écrans et non des données, se cherchent en
 * mémoire (`palette/useSurfaceSearch`).
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
   * Élément actif de la liste, tenu par nous plutôt que par cmdk.
   *
   * `shouldFilter={false}` désactive la passe de filtrage de cmdk — et c'est cette passe qui,
   * chez lui, resélectionne le premier item. Résultat : après une frappe, les actions rapides
   * étaient démontées et les résultats montés, mais la valeur active restait celle d'un item
   * disparu. **Plus aucun élément n'était sélectionné**, donc Entrée ne faisait rien : il
   * fallait d'abord appuyer sur ↓. Une palette dont la première frappe d'Entrée est perdue
   * n'est pas une palette.
   */
  const [active, setActive] = useState('');
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

  // La requête a changé : le jeu de résultats va changer aussi. On vide la sélection pour que
  // cmdk reprenne la main et désigne le premier item dès qu'il est monté.
  //
  // Ajusté PENDANT le rendu plutôt que dans un effet (motif React admis, déjà employé par
  // `Shell` au changement de type de média) : dans un effet, la liste se serait affichée un
  // rendu entier sans sélection — exactement la fenêtre où l'utilisateur appuie sur Entrée.
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
  // Saisie vidée → on ré-affiche les actions rapides, jamais les vieux résultats
  const results = canSearch ? (data ?? EMPTY_SEARCH) : EMPTY_SEARCH;

  // Commandes contextuelles du viewer de review monté (B3) — filtrées côté client, la
  // recherche serveur ne les connaît pas.
  const reviewCommands = useReviewCommands((s) => s.commands);
  const matchingReview = hasQuery
    ? reviewCommands.filter((c) => c.label.toLowerCase().includes(typed.toLowerCase()))
    : reviewCommands;

  // Documentation et réglages : deux familles d'**écrans**, calculées en mémoire (le corpus
  // de doc et l'index des réglages vivent côté client). Elles suivent la frappe sans attendre
  // le débounce, comme les destinations et les actions rapides — rien ne part sur le réseau.
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
