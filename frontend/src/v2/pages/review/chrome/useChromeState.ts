import { useCallback, useEffect, useMemo, useState } from 'react';
import type { MediaKind } from '../../../types/api';
import {
  chromePrefsKey,
  defaultChromeState,
  readChromePrefs,
  reconcileChrome,
  type ChromeState,
} from './chromeState';
import { switcherModesFor } from './modes';
import { panelsFor } from './panels';
import { DEFAULT_TOOL, toolSearchOrder, toolsFor } from './tools';

/**
 * État du chrome pour un média : préférences relues au montage (rail déplié, panneau ouvert,
 * commentaires visibles), mode/outil/tiroir éphémères, et les raccourcis communs aux quatre
 * viewers — touches 1 à 4 pour les modes, lettres d'outils du rail, Échap pour revenir à la
 * navigation, `Tab` pour replier le dock.
 *
 * Toute mise à jour repasse par `reconcileChrome` : impossible de rester sur un outil qui
 * n'existe pas dans le mode courant.
 */
function initialState(kind: MediaKind): ChromeState {
  const base = defaultChromeState();
  if (typeof window === 'undefined') return base;
  return { ...base, ...readChromePrefs(kind, window.localStorage.getItem(chromePrefsKey(kind))) };
}

export function useChromeState(kind: MediaKind) {
  const [state, setState] = useState<ChromeState>(() => initialState(kind));

  const update = useCallback(
    (patch: Partial<ChromeState>) => setState((prev) => reconcileChrome({ ...prev, ...patch }, kind)),
    [kind],
  );

  // Changement de média : on repart des préférences de ce type, mode et outil au repos.
  // Ajusté pendant le rendu plutôt que dans un effet — pas de rendu intermédiaire périmé.
  const [lastKind, setLastKind] = useState(kind);
  if (lastKind !== kind) {
    setLastKind(kind);
    setState(initialState(kind));
  }

  // Les trois préférences sont persistées par type de média ; le reste est éphémère.
  useEffect(() => {
    const { panel, labels, comments } = state;
    window.localStorage.setItem(chromePrefsKey(kind), JSON.stringify({ panel, labels, comments }));
  }, [kind, state]);

  const modes = useMemo(() => switcherModesFor(kind), [kind]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      // Jamais de raccourci pendant une saisie (commentaire, champ numérique, recherche).
      if (target?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName ?? '')) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      if (e.key === 'Tab') {
        e.preventDefault();
        // Tab replie le dock ouvert, ou rouvre le premier panneau du média.
        update({ panel: state.panel ? null : (panelsFor(kind)[0]?.id ?? null) });
        return;
      }
      if (e.key === 'Escape') {
        // Échap ramène au repos : la navigation, quel que soit le mode.
        if (state.tool !== DEFAULT_TOOL) {
          e.preventDefault();
          update({ tool: DEFAULT_TOOL });
        }
        return;
      }
      const index = Number(e.key) - 1;
      if (Number.isInteger(index) && index >= 0 && index < modes.length) {
        e.preventDefault();
        update({ mode: modes[index]!.value });
        return;
      }
      // Lettre d'outil : le mode courant d'abord, sinon les autres modes — armer l'outil d'un
      // autre mode y bascule (T/R/S ramènent à « Nettoyer », un outil de tracé arme
      // l'annotation), au lieu de ne rien faire.
      const key = e.key.toUpperCase();
      for (const mode of toolSearchOrder(kind, state.mode)) {
        const tool = toolsFor(mode, kind).find((t) => t.key === key);
        if (tool) {
          e.preventDefault();
          update(mode === state.mode ? { tool: tool.id } : { mode, tool: tool.id });
          return;
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [kind, modes, state.mode, state.panel, state.tool, update]);

  return { state, update };
}
