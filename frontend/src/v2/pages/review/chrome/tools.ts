// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  Brush,
  BoxSelect,
  Circle,
  Crosshair,
  Eraser,
  Frame,
  Hand,
  Hexagon,
  Home,
  Lasso,
  Maximize2,
  MapPin,
  Move,
  Move3d,
  MoveHorizontal,
  MoveUpRight,
  Pencil,
  Rotate3d,
  Scale3d,
  Scan,
  Square,
  SquareDashed,
  Type,
  type LucideIcon,
} from 'lucide-react';
import type { MediaKind } from '../../../types/api';
import type { MessageKey } from '../../../i18n';
import { isSpatialKind, modesFor, type ModeId } from './modes';

/**
 * Rail d'outils — les outils de pointage **exclusifs** du mode actif : un seul est armé à la
 * fois, et il décide de ce que fait le clic dans la vue. Tout ce qui n'est pas un geste de
 * pointage (réglages, bascules) vit dans le dock, pas ici.
 *
 * Le premier outil est toujours `nav` : c'est l'état de repos de chaque mode.
 */
export type ToolId =
  | 'nav'
  | 'draw'
  | 'rect'
  | 'ellipse'
  | 'arrow'
  | 'polygon'
  | 'text'
  | 'shape-move'
  | 'erase'
  | 'wipe'
  | 'focus'
  | 'pin'
  | 'paint'
  | 'cam-move'
  | 'cam-aim'
  | 'sel-rect'
  | 'sel-lasso'
  | 'sel-brush'
  | 'volume'
  | 'translate'
  | 'rotate'
  | 'scale';

export interface ReviewTool {
  id: ToolId;
  labelKey: MessageKey;
  icon: LucideIcon;
  /** Raccourci clavier — repris dans l'infobulle et à droite du libellé, rail déplié. */
  key: string;
  hintKey: MessageKey;
  /** Restreint l'outil à un type de média (les outils de sélection sont propres au splat). */
  kind?: MediaKind;
}

/** Action de vue du bas du rail : ne change pas l'outil armé, agit tout de suite. */
export interface ViewAction {
  id: 'fit' | 'reset';
  icon: LucideIcon;
  labelKey: MessageKey;
  key: string;
}

export const DEFAULT_TOOL: ToolId = 'nav';

const NAV_HINT_MEDIA: MessageKey = 'tool.nav.hintMedia';
const NAV_HINT_SPATIAL: MessageKey = 'tool.nav.hintSpatial';

const nav = (hintKey: MessageKey): ReviewTool => ({
  id: 'nav',
  labelKey: 'tool.nav',
  icon: Hand,
  key: 'V',
  hintKey,
});

/** Outils de tracé du mode « Annoter » — vidéo et image. */
export const DRAW_TOOLS: ReviewTool[] = [
  { id: 'draw', labelKey: 'tool.draw', icon: Pencil, key: 'D', hintKey: 'tool.draw.hint' },
  { id: 'rect', labelKey: 'tool.rect', icon: Square, key: 'R', hintKey: 'tool.rect.hint' },
  { id: 'ellipse', labelKey: 'tool.ellipse', icon: Circle, key: 'E', hintKey: 'tool.ellipse.hint' },
  { id: 'arrow', labelKey: 'tool.arrow', icon: MoveUpRight, key: 'A', hintKey: 'tool.arrow.hint' },
  {
    // ARBITRAGE — le polygone était sur `G`, la touche du LEADER de navigation globale
    // (`g` puis une lettre : `g p` → projets, `g k` → kanban, `g b` → board). Les deux
    // gestionnaires sont posés sur des cibles différentes (`document` pour le global,
    // `window` pour le rail) : une frappe armait le polygone *et* amorçait la séquence,
    // et la lettre suivante faisait quitter la review, annotation en cours perdue.
    //
    // Le leader `g` n'est pas reconfigurable (`isValidKey` le refuse) : c'est donc l'outil
    // qui cède. `P` est libre sur les médias plats — `paint` et `sel-brush` la portent, mais
    // seulement en spatial, où le polygone n'existe pas.
    id: 'polygon',
    labelKey: 'tool.polygon',
    icon: Hexagon,
    key: 'P',
    hintKey: 'tool.polygon.hint',
  },
  { id: 'text', labelKey: 'tool.text', icon: Type, key: 'T', hintKey: 'tool.text.hint' },
  {
    // ARBITRAGE — le déplacement de forme était sur `M`, la touche du transport vidéo
    // (« pause + commentaire à la frame courante »). Le transport la gardait en coupant la
    // remontée de l'événement : sur une vidéo, le bouton du rail annonçait donc `M` et la
    // lettre n'armait rien — elle ouvrait le composer. `S` est libre sur les médias plats.
    id: 'shape-move',
    labelKey: 'tool.shapeMove',
    icon: Move,
    key: 'S',
    hintKey: 'tool.shapeMove.hint',
  },
  { id: 'erase', labelKey: 'tool.erase', icon: Eraser, key: 'X', hintKey: 'tool.erase.hint' },
];

/**
 * L'outil « Zoom » (`Z`) a été RETIRÉ (Phase 50) : il n'a jamais rien armé. Le zoom des deux
 * viewers plats est un geste permanent — molette pour zoomer sous le curseur, glissement pour
 * déplacer, `+`/`-` au clavier — et ne dépend d'aucun outil ; le lecteur vidéo le masquait
 * même du rail tout en le laissant armable au clavier. Ajuster et 1:1 restent offerts par les
 * deux actions de vue (`F` et `H`), qui, elles, agissent.
 */
function mediaTools(mode: ModeId): ReviewTool[] {
  const start = nav(NAV_HINT_MEDIA);
  if (mode === 'annotate') return [start, ...DRAW_TOOLS];
  if (mode === 'compare')
    return [
      start,
      {
        id: 'wipe',
        labelKey: 'tool.wipe',
        icon: MoveHorizontal,
        key: 'W',
        hintKey: 'tool.wipe.hint',
      },
    ];
  return [start];
}

const FOCUS: ReviewTool = {
  id: 'focus',
  labelKey: 'tool.focus',
  icon: Crosshair,
  key: 'C',
  kind: 'SPLAT',
  hintKey: 'tool.focus.hint',
};

const SPATIAL_TOOLS: Record<string, ReviewTool[]> = {
  explore: [
    nav(NAV_HINT_SPATIAL),
    FOCUS,
    {
      id: 'pin',
      labelKey: 'tool.poi',
      icon: MapPin,
      key: 'I',
      hintKey: 'tool.poi.hint',
    },
  ],
  annotate: [
    nav(NAV_HINT_SPATIAL),
    {
      // Le painter 3D n'existe que sur un splat : le viewer 3D le retirait du rail, et la
      // lettre l'armait quand même. La restriction par type le retire des deux d'un coup.
      id: 'paint',
      labelKey: 'tool.paint',
      icon: Brush,
      key: 'P',
      kind: 'SPLAT',
      hintKey: 'tool.paint.hint',
    },
    // L'outil « Région » (`B`) a été RETIRÉ (Phase 50) : les deux viewers spatiaux le
    // masquaient du rail — il n'avait donc aucune implémentation nulle part — et la lettre
    // l'armait quand même au clavier.
    {
      id: 'pin',
      labelKey: 'tool.pin',
      icon: MapPin,
      key: 'I',
      hintKey: 'tool.pin.hint',
    },
  ],
  stage: [
    nav(NAV_HINT_SPATIAL),
    {
      id: 'cam-move',
      labelKey: 'tool.camMove',
      icon: Move3d,
      key: 'T',
      hintKey: 'tool.camMove.hint',
    },
    {
      id: 'cam-aim',
      labelKey: 'tool.camAim',
      icon: Rotate3d,
      key: 'R',
      hintKey: 'tool.camAim.hint',
    },
    { ...FOCUS, hintKey: 'tool.focus.hintStage' },
  ],
  clean: [
    nav(NAV_HINT_SPATIAL),
    {
      id: 'sel-rect',
      labelKey: 'tool.selRect',
      icon: SquareDashed,
      key: 'B',
      kind: 'SPLAT',
      hintKey: 'tool.selRect.hint',
    },
    {
      id: 'sel-lasso',
      labelKey: 'tool.selLasso',
      icon: Lasso,
      key: 'L',
      kind: 'SPLAT',
      hintKey: 'tool.selLasso.hint',
    },
    {
      id: 'sel-brush',
      labelKey: 'tool.selBrush',
      icon: Brush,
      key: 'P',
      kind: 'SPLAT',
      hintKey: 'tool.selBrush.hint',
    },
    {
      id: 'volume',
      labelKey: 'tool.volume',
      icon: BoxSelect,
      key: 'O',
      kind: 'SPLAT',
      hintKey: 'tool.volume.hint',
    },
    { id: 'translate', labelKey: 'tool.translate', icon: Move3d, key: 'T', hintKey: 'tool.translate.hint' },
    { id: 'rotate', labelKey: 'tool.rotate', icon: Rotate3d, key: 'R', hintKey: 'tool.rotate.hint' },
    { id: 'scale', labelKey: 'tool.scale', icon: Scale3d, key: 'S', hintKey: 'tool.scale.hint' },
  ],
};

/** Outils du mode actif, filtrés par type de média. */
export function toolsFor(mode: ModeId, kind: MediaKind): ReviewTool[] {
  const tools = isSpatialKind(kind) ? (SPATIAL_TOOLS[mode] ?? []) : mediaTools(mode);
  return tools.filter((t) => !t.kind || t.kind === kind);
}

/**
 * Ordre de recherche d'un raccourci d'outil : le mode courant d'abord, puis les autres —
 * presser la touche d'un outil d'un autre mode **bascule** vers ce mode. En spatial, `clean`
 * passe en tête des autres : T/R/S sont les gizmos standard des DCC et doivent répondre
 * depuis n'importe quel mode (les outils caméra de « Mise en scène », qui partagent T/R,
 * gardent la main quand on y est déjà).
 */
export function toolSearchOrder(kind: MediaKind, current: ModeId): ModeId[] {
  const all = modesFor(kind).map((m) => m.value);
  const others = isSpatialKind(kind) ? ['clean' as ModeId, ...all] : all;
  return [current, ...others.filter((mode, index) => mode !== current && others.indexOf(mode) === index)];
}

const SPATIAL_ACTIONS: ViewAction[] = [
  { id: 'fit', icon: Frame, labelKey: 'action.fitSpatial', key: 'F' },
  { id: 'reset', icon: Home, labelKey: 'action.resetSpatial', key: 'H' },
];

const MEDIA_ACTIONS: ViewAction[] = [
  { id: 'fit', icon: Maximize2, labelKey: 'action.fitMedia', key: 'F' },
  { id: 'reset', icon: Scan, labelKey: 'action.resetMedia', key: 'H' },
];

/** Actions de vue du bas du rail, après le séparateur. */
export function viewActionsFor(kind: MediaKind): ViewAction[] {
  return isSpatialKind(kind) ? SPATIAL_ACTIONS : MEDIA_ACTIONS;
}
