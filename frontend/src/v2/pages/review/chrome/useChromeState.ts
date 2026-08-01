import { useCallback, useEffect, useMemo, useState } from 'react';
import type { MediaKind } from '../../../types/api';
import {
  chromePrefsKey,
  defaultChromeState,
  readChromePrefs,
  reconcileChrome,
  type ChromeState,
} from './chromeState';
import { modesFor } from './modes';

/**
 * État du chrome pour un média : préférences relues au montage (rail déplié, panneau ouvert,
 * commentaires visibles), mode/outil/tiroir éphémères, et les raccourcis communs aux quatre
 * viewers — touches 1 à 4 pour les modes, `Tab` pour replier le dock.
 *
 * Toute mise à jour repasse par `reconcileChrome` : impossible de rester sur un outil qui
 * n'existe pas dans le mode courant.
 */
function initialState(kind: MediaKind): ChromeState {
  const base = defaultChromeState(kind);
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

  const modes = useMemo(() => modesFor(kind), [kind]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      // Jamais de raccourci pendant une saisie (commentaire, champ numérique, recherche).
      if (target?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName ?? '')) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      if (e.key === 'Tab') {
        e.preventDefault();
        update({ panel: state.panel ? null : defaultChromeState(kind).panel });
        return;
      }
      const index = Number(e.key) - 1;
      if (Number.isInteger(index) && index >= 0 && index < modes.length) {
        e.preventDefault();
        update({ mode: modes[index]!.value });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [kind, modes, state.panel, update]);

  return { state, update };
}
