// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { MediaKind } from '../../../types/api';
import type { MessageKey } from '../../../i18n';
import { modesFor, switcherModesFor, type ModeId, type ReviewMode } from './modes';
import {
  DEFAULT_TOOL,
  toolSearchOrder,
  toolsFor,
  viewActionsFor,
  type ReviewTool,
  type ToolId,
} from './tools';

/**
 * Registre des raccourcis de la review — **source de vérité unique**.
 *
 * Deux listes existaient : celle que les gestionnaires appliquent, et celle que l'aide
 * (`components/ShortcutsHelp`) récitait. Elles ont divergé — l'aide omettait `Tab`, `+`/`-`,
 * les crochets de décalage A/B, les bookmarks caméra et la moitié des outils du rail, tout en
 * promettant un outil « Zoom » qui n'armait rien. Ce fichier porte donc les deux rôles :
 *
 *  1. `chromeCommandFor` **résout** une frappe du chrome (mode, outil, dock, repos) — c'est ce
 *     que `useChromeState` applique, et rien d'autre ne décide de ces touches ;
 *  2. `reviewShortcutGroups` **décrit** tous les raccourcis de la review pour l'aide, qui s'en
 *     déduit au lieu de tenir sa propre copie.
 *
 * Les touches d'outils et les deux actions de vue sont **dérivées de `tools.ts`** : on ne les
 * recopie jamais, sinon la divergence revient par la porte de service. Chaque entrée nomme le
 * gestionnaire qui l'exécute (`handler`) : une entrée sans gestionnaire est un raccourci mort,
 * et le test du registre le refuse.
 */

/**
 * Une touche telle qu'elle s'affiche. `char` est un caractère technique, rendu dans un `<kbd>` :
 * une lettre, un chiffre, un symbole, ou un nom de modificateur identique dans toutes les
 * langues (`Ctrl`, `Alt`, `Tab`). Tout nom de touche qui se traduit — Espace, Maj, Suppr, clic
 * droit, ZQSD — passe par `nameKey`, jamais par `char` : les treize autres catalogues doivent
 * pouvoir le rendre.
 */
export type KeyToken = { char: string } | { nameKey: MessageKey };

export interface ReviewShortcut {
  /** Touches du raccourci, dans l'ordre d'affichage. */
  keys: KeyToken[];
  labelKey: MessageKey;
  /** Hook ou composant qui exécute réellement le geste. */
  handler: string;
}

export interface ShortcutGroup {
  titleKey: MessageKey;
  shortcuts: ReviewShortcut[];
}

const ch = (char: string): KeyToken => ({ char });
const named = (nameKey: MessageKey): KeyToken => ({ nameKey });

/** Touches identiques partout : ce sont les seules à s'écrire en clair dans un `char`. */
export const NEUTRAL_KEY_NAMES = ['Ctrl', 'Alt', 'Tab'];

// ───────────────────────────── résolution d'une frappe ─────────────────────────────

/** Ce qu'une frappe demande au chrome. `null` = la touche ne nous appartient pas. */
export type ChromeCommand =
  | { action: 'panel' }
  | { action: 'rest' }
  | { action: 'mode'; mode: ModeId }
  | { action: 'tool'; mode: ModeId; tool: ToolId };

export interface ChromeKeyContext {
  kind: MediaKind;
  mode: ModeId;
  tool: ToolId;
  /** Modes offerts par la bascule, dans l'ordre des touches numériques. */
  modes: ReviewMode[];
  /**
   * Outils réellement au rail pour un mode. Par défaut ceux du type de média ; le lecteur de
   * montage passe les siens — un outil absent du rail ne doit pas être armable au clavier.
   */
  toolsOf: (mode: ModeId) => ReviewTool[];
}

/**
 * Résout une frappe du chrome. Fonction pure : les gardes (saisie en cours, modificateurs,
 * dialogue ouvert) restent au gestionnaire, qui seul connaît l'événement.
 */
export function chromeCommandFor(key: string, ctx: ChromeKeyContext): ChromeCommand | null {
  if (key === 'Tab') return { action: 'panel' };
  // Échap ne fait quelque chose que s'il y a de quoi : sinon la touche repart vers les autres
  // écouteurs (sortie du mode théâtre, désélection d'un commentaire).
  if (key === 'Escape') return ctx.tool === DEFAULT_TOOL ? null : { action: 'rest' };

  const index = Number(key) - 1;
  if (Number.isInteger(index) && index >= 0 && index < ctx.modes.length)
    return { action: 'mode', mode: ctx.modes[index].value };

  // Lettre d'outil : le mode courant d'abord, sinon les autres modes — armer l'outil d'un
  // autre mode y bascule (T/R/S ramènent à « Nettoyer », un outil de tracé arme l'annotation),
  // au lieu de ne rien faire.
  const letter = key.toUpperCase();
  if (letter.length !== 1) return null;
  for (const mode of toolSearchOrder(ctx.kind, ctx.mode)) {
    const tool = ctx.toolsOf(mode).find((t) => t.key === letter);
    if (tool) return { action: 'tool', mode, tool: tool.id };
  }
  return null;
}

// ─────────────────────────────── description pour l'aide ───────────────────────────────

const CHROME = 'useChromeState';

/** Rangées des outils d'un type de média — leurs touches viennent de `tools.ts`. */
function toolRows(kind: MediaKind): ReviewShortcut[] {
  const rows: ReviewShortcut[] = [];
  // Un outil revient dans plusieurs modes (`nav` partout, la mise au point en exploration et
  // en mise en scène) : une rangée par couple touche + libellé. La clé de traduction n'est
  // jamais concaténée dans un identifiant — une clé n'a rien à faire dans une chaîne assemblée.
  const seen = new Map<string, Set<MessageKey>>();
  for (const mode of modesFor(kind))
    for (const tool of toolsFor(mode.value, kind)) {
      const labels = seen.get(tool.key) ?? new Set<MessageKey>();
      if (labels.has(tool.labelKey)) continue;
      seen.set(tool.key, labels.add(tool.labelKey));
      rows.push({ keys: [ch(tool.key)], labelKey: tool.labelKey, handler: CHROME });
    }
  return rows;
}

/** Les deux actions de vue (`F`, `H`) avec le libellé du type de média. */
function viewRows(kind: MediaKind, handler: string): ReviewShortcut[] {
  return viewActionsFor(kind).map((a) => ({ keys: [ch(a.key)], labelKey: a.labelKey, handler }));
}

/** Raccourcis du chrome, communs aux quatre viewers. */
function chromeRows(): ReviewShortcut[] {
  return [
    {
      // Les touches numériques suivent la bascule de mode : au plus trois modes (spatial),
      // deux sur un média plat. L'infobulle de chaque segment porte le même numéro.
      keys: switcherModesFor('SPLAT').map((_, i) => ch(String(i + 1))),
      labelKey: 'review.mode',
      handler: CHROME,
    },
    { keys: [ch('Tab')], labelKey: 'shortcuts.dock', handler: CHROME },
    { keys: [named('common.escKey')], labelKey: 'shortcuts.restTool', handler: CHROME },
    { keys: [ch('Ctrl'), ch('V')], labelKey: 'shortcuts.pasteReference', handler: 'ReviewCanvasRefs' },
    // Deux rangées plutôt qu'un « Ctrl + Z / Y » : chaque touche est écrite telle qu'on la presse.
    { keys: [ch('Ctrl'), ch('Z')], labelKey: 'common.undo', handler: 'useAnnotationShortcuts' },
    { keys: [ch('Ctrl'), ch('Y')], labelKey: 'common.redo', handler: 'useAnnotationShortcuts' },
    { keys: [named('key.rightClick')], labelKey: 'shortcuts.contextMenu', handler: 'ReviewContextMenu' },
  ];
}

/** Transport du lecteur vidéo et décalage de la comparaison A/B. */
function videoRows(): ReviewShortcut[] {
  const transport = 'useReviewShortcuts';
  return [
    { keys: [named('key.space')], labelKey: 'shortcuts.playPause', handler: transport },
    { keys: [ch('←'), ch('→')], labelKey: 'shortcuts.frameStep', handler: transport },
    { keys: [named('key.shift'), ch('←/→')], labelKey: 'shortcuts.frameStep10', handler: transport },
    { keys: [ch('J')], labelKey: 'shortcuts.playBackward', handler: transport },
    { keys: [ch('K')], labelKey: 'shortcuts.pause', handler: transport },
    { keys: [ch('L')], labelKey: 'shortcuts.playForward', handler: transport },
    { keys: [ch('I'), ch('O')], labelKey: 'shortcuts.loopPoints', handler: transport },
    { keys: [ch('M')], labelKey: 'shortcuts.commentAtFrame', handler: transport },
    { keys: [ch('['), ch(']')], labelKey: 'shortcuts.compareOffset', handler: transport },
    {
      keys: [named('key.shift'), ch('\\')],
      labelKey: 'shortcuts.compareOffsetReset',
      handler: transport,
    },
  ];
}

/** Vue des deux viewers plats : ajuster, 1:1, pas de zoom. */
function flatRows(): ReviewShortcut[] {
  return [
    ...toolRows('VIDEO'),
    ...viewRows('VIDEO', 'useViewShortcuts'),
    { keys: [ch('+'), ch('-')], labelKey: 'shortcuts.zoomStep', handler: 'useViewportZoom' },
  ];
}

/** Viewers spatiaux : outils, vol, cadrage, édition, bookmarks et transport caméra. */
function spatialRows(): ReviewShortcut[] {
  const camera = 'useCameraShortcuts';
  return [
    ...toolRows('SPLAT'),
    {
      keys: [named('key.rightClick'), named('key.wasd')],
      labelKey: 'shortcuts.splatFly',
      handler: 'flyControls',
    },
    ...viewRows('SPLAT', 'useFrameShortcuts'),
    { keys: [named('key.delete')], labelKey: 'shortcuts.deleteSelection', handler: 'useEditorShortcuts' },
    {
      keys: [ch('Alt'), ch('1'), ch('9')],
      labelKey: 'shortcuts.cameraBookmark',
      handler: 'useModel3DBookmarks',
    },
    { keys: [named('key.space')], labelKey: 'shortcuts.cameraPlay', handler: camera },
    { keys: [ch('K')], labelKey: 'shortcuts.cameraKey', handler: camera },
    { keys: [ch('←'), ch('→')], labelKey: 'shortcuts.cameraKeyNav', handler: camera },
    {
      keys: [named('key.home'), named('key.end')],
      labelKey: 'shortcuts.cameraBounds',
      handler: camera,
    },
  ];
}

/**
 * Tous les groupes de raccourcis de la review, dans l'ordre d'affichage de l'aide. La section
 * « Navigation », elle, reste pilotée par `lib/shortcutRegistry` : ses touches sont
 * reconfigurables et persistées côté compte, ce que ces raccourcis-là ne sont pas.
 */
export function reviewShortcutGroups(): ShortcutGroup[] {
  return [
    { titleKey: 'shortcuts.allTypes', shortcuts: chromeRows() },
    { titleKey: 'shortcuts.videoReview', shortcuts: videoRows() },
    { titleKey: 'shortcuts.flatTools', shortcuts: flatRows() },
    { titleKey: 'shortcuts.spatialTools', shortcuts: spatialRows() },
  ];
}
