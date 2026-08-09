// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { MediaKind } from '../../../types/api';
import { DEFAULT_MODE, isSpatialKind, modesFor, type ModeId } from './modes';
import { panelsFor, type PanelId } from './panels';
import { DEFAULT_TOOL, toolsFor, type ToolId } from './tools';

/**
 * État du chrome de review — une seule source par workspace, découpée par domaine. Les hooks
 * métier (annotations, caméra, splat…) gardent leur état ; on ne décrit ici que ce qui pilote
 * les cinq emplacements du chrome.
 *
 * `labels`, `panel` et `comments` sont des **préférences** : persistées par utilisateur et par
 * type de média. `mode`, `tool` et `drawer` sont éphémères et repartent à leur défaut.
 */
export type DrawerId = 'strip' | 'curves';

export interface ChromeState {
  mode: ModeId;
  tool: ToolId;
  /** `null` = dock replié sur sa bande d'onglets. */
  panel: PanelId | null;
  /** Rail déplié : libellés et raccourcis visibles à côté des icônes. */
  labels: boolean;
  comments: boolean;
  drawer: DrawerId | null;
  /** Hauteur du tiroir (px) — redimensionnable, persistée. */
  drawerH: number;
}

/** Bornes de la hauteur du tiroir (poignée de redimensionnement). */
export const DRAWER_MIN_H = 120;
export const DRAWER_MAX_H = 480;
export const DRAWER_DEFAULT_H = 168;

/** Le tiroir ancré sous le transport : courbes d'animation en 3D, pellicule en vidéo/image. */
export function drawerForKind(kind: MediaKind): DrawerId {
  return isSpatialKind(kind) ? 'curves' : 'strip';
}

export function defaultChromeState(): ChromeState {
  return {
    mode: DEFAULT_MODE,
    tool: DEFAULT_TOOL,
    // Dock replié à la première ouverture : le média passe avant les réglages. L'utilisateur
    // l'ouvre quand il en a besoin, et sa préférence est retenue par type de média.
    panel: null,
    labels: false,
    comments: true,
    drawer: null,
    drawerH: DRAWER_DEFAULT_H,
  };
}

/**
 * Ramène un état à ce qui existe réellement pour ce média et ce mode : outil inconnu du mode
 * → `nav`, panneau absent du dock → premier panneau, tiroir d'une autre famille → fermé.
 * Appelé au changement de mode comme au changement de média ; retourne l'objet d'origine
 * quand rien ne bouge, pour ne pas déclencher de rendu inutile.
 */
export function reconcileChrome(state: ChromeState, kind: MediaKind): ChromeState {
  const mode = modesFor(kind).some((m) => m.value === state.mode) ? state.mode : DEFAULT_MODE;
  const tool = toolsFor(mode, kind).some((t) => t.id === state.tool) ? state.tool : DEFAULT_TOOL;
  const panels = panelsFor(kind);
  const panel =
    state.panel === null || panels.some((p) => p.id === state.panel) ? state.panel : (panels[0]?.id ?? null);
  const drawer = state.drawer === drawerForKind(kind) ? state.drawer : null;

  if (mode === state.mode && tool === state.tool && panel === state.panel && drawer === state.drawer)
    return state;
  return { ...state, mode, tool, panel, drawer };
}

/** Clé de persistance des préférences — une par type de média. */
export function chromePrefsKey(kind: MediaKind): string {
  return `review.chrome.${kind}`;
}

/**
 * Sous-ensemble persisté de l'état : les préférences, jamais le mode ni l'outil courants.
 * Le tiroir est retenu par son état ouvert (`drawerOpen`) — l'identité du tiroir dépend du
 * média (`drawerForKind`), pas de la préférence.
 */
export type ChromePrefs = Pick<ChromeState, 'panel' | 'labels' | 'comments' | 'drawerH'> & {
  drawerOpen: boolean;
};

export function readChromePrefs(kind: MediaKind, raw: string | null): ChromePrefs {
  const base = defaultChromeState();
  const fallback: ChromePrefs = {
    panel: base.panel,
    labels: base.labels,
    comments: base.comments,
    drawerOpen: false,
    drawerH: base.drawerH,
  };
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as Partial<ChromePrefs>;
    const known = panelsFor(kind);
    return {
      panel:
        parsed.panel === null || known.some((p) => p.id === parsed.panel)
          ? (parsed.panel ?? null)
          : fallback.panel,
      labels: typeof parsed.labels === 'boolean' ? parsed.labels : fallback.labels,
      comments: typeof parsed.comments === 'boolean' ? parsed.comments : fallback.comments,
      drawerOpen: typeof parsed.drawerOpen === 'boolean' ? parsed.drawerOpen : fallback.drawerOpen,
      drawerH:
        typeof parsed.drawerH === 'number' && Number.isFinite(parsed.drawerH)
          ? Math.min(DRAWER_MAX_H, Math.max(DRAWER_MIN_H, parsed.drawerH))
          : fallback.drawerH,
    };
  } catch {
    // Préférence corrompue (édition manuelle, ancien format) : on repart des défauts.
    return fallback;
  }
}
