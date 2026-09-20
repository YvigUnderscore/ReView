// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { MediaKind } from '../../../types/api';
import {
  chromePrefsKey,
  defaultChromeState,
  drawerForKind,
  readChromePrefs,
  reconcileChrome,
  type ChromeState,
} from './chromeState';
import { switcherModesFor, type ModeId, type ReviewMode } from './modes';
import { panelsFor } from './panels';
import { chromeCommandFor } from './shortcuts';
import { DEFAULT_TOOL, toolsFor, type ReviewTool } from './tools';

/**
 * État du chrome pour un média : préférences relues au montage (rail déplié, panneau ouvert,
 * commentaires visibles), mode/outil/tiroir éphémères, et les raccourcis communs aux quatre
 * viewers — touches numériques pour les modes, lettres d'outils du rail, Échap pour revenir à la
 * navigation, `Tab` pour replier le dock.
 *
 * Les touches ne sont pas décidées ici : elles sont résolues par `chromeCommandFor`, le registre
 * partagé avec l'aide des raccourcis. Ce hook applique la commande, rien de plus.
 *
 * Toute mise à jour repasse par `reconcileChrome` : impossible de rester sur un outil qui
 * n'existe pas dans le mode courant.
 */
function initialState(kind: MediaKind): ChromeState {
  const base = defaultChromeState();
  if (typeof window === 'undefined') return base;
  const { drawerOpen, ...prefs } = readChromePrefs(kind, window.localStorage.getItem(chromePrefsKey(kind)));
  return { ...base, ...prefs, drawer: drawerOpen ? drawerForKind(kind) : null };
}

export interface ChromeOptions {
  /**
   * Au moins une version voisine existe. Faux, le mode « Compare » quitte la bascule **et** les
   * touches numériques — un mode qui ne peut rien montrer ne s'arme pas.
   */
  canCompare?: boolean;
  /**
   * Modes réellement offerts par la bascule. Le lecteur de montage n'en a qu'un : sans cette
   * option, la touche `2` l'envoyait dans un mode « Compare » que son en-tête ne propose pas.
   */
  modes?: ReviewMode[];
  /**
   * Outils réellement au rail. Le montage fournit les siens ; un outil absent du rail ne doit
   * pas être armable au clavier, sinon la lettre arme un outil sans implémentation.
   */
  tools?: (mode: ModeId) => ReviewTool[];
}

export function useChromeState(kind: MediaKind, options: ChromeOptions = {}) {
  const { canCompare = true, modes: modesOption, tools: toolsOption } = options;
  const [state, setState] = useState<ChromeState>(() => initialState(kind));

  const update = useCallback(
    (patch: Partial<ChromeState>) =>
      setState((prev) => reconcileChrome({ ...prev, ...patch }, kind, canCompare)),
    [kind, canCompare],
  );

  // Changement de média : on repart des préférences de ce type, mode et outil au repos.
  // Ajusté pendant le rendu plutôt que dans un effet — pas de rendu intermédiaire périmé.
  const [lastKind, setLastKind] = useState(kind);
  if (lastKind !== kind) {
    setLastKind(kind);
    setState(initialState(kind));
  }

  // Les versions voisines arrivent après le premier rendu : quand `canCompare` retombe, l'état
  // courant repasse au crible au lieu d'attendre la prochaine action — sans quoi l'on resterait
  // dans un mode « Compare » que la bascule vient de retirer.
  const [lastCanCompare, setLastCanCompare] = useState(canCompare);
  if (lastCanCompare !== canCompare) {
    setLastCanCompare(canCompare);
    setState((prev) => reconcileChrome(prev, kind, canCompare));
  }

  // Les préférences sont persistées par type de média ; mode et outil restent éphémères.
  useEffect(() => {
    const { panel, labels, comments, drawer, drawerH } = state;
    window.localStorage.setItem(
      chromePrefsKey(kind),
      JSON.stringify({ panel, labels, comments, drawerOpen: drawer != null, drawerH }),
    );
  }, [kind, state]);

  const modes = useMemo(
    () => modesOption ?? switcherModesFor(kind, canCompare),
    [modesOption, kind, canCompare],
  );
  const toolsOf = useMemo(() => toolsOption ?? ((mode: ModeId) => toolsFor(mode, kind)), [toolsOption, kind]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      // Jamais de raccourci pendant une saisie (commentaire, champ numérique, recherche).
      if (target?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName ?? '')) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      // Une seule autorité sur ces touches : le registre. Le garde-fou `reservedKeys` a disparu
      // avec le mode Découpe (Phase 50) — il existait parce que `I`/`O` étaient à la fois la
      // boucle du transport et les points de coupe, et plus aucun outil ne porte ces lettres.
      const command = chromeCommandFor(e.key, {
        kind,
        mode: state.mode,
        tool: state.tool,
        modes,
        toolsOf,
      });
      if (!command) return;
      e.preventDefault();
      if (command.action === 'panel') {
        // Tab replie le dock ouvert, ou rouvre le premier panneau du média.
        update({ panel: state.panel ? null : (panelsFor(kind)[0]?.id ?? null) });
      } else if (command.action === 'rest') {
        update({ tool: DEFAULT_TOOL });
      } else if (command.action === 'mode') {
        update({ mode: command.mode });
      } else {
        update(
          command.mode === state.mode ? { tool: command.tool } : { mode: command.mode, tool: command.tool },
        );
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [kind, modes, toolsOf, state.mode, state.panel, state.tool, update]);

  return { state, update };
}
