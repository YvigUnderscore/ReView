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
  LogIn,
  LogOut,
  Maximize2,
  MapPin,
  Move,
  Move3d,
  MoveHorizontal,
  MoveUpRight,
  Pencil,
  Pipette,
  Rotate3d,
  Ruler,
  Scale3d,
  Scan,
  Square,
  SquareDashed,
  Type,
  ZoomIn,
  type LucideIcon,
} from 'lucide-react';
import type { MediaKind } from '../../../types/api';
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
  | 'zoom'
  | 'draw'
  | 'rect'
  | 'ellipse'
  | 'arrow'
  | 'polygon'
  | 'text'
  | 'shape-move'
  | 'erase'
  | 'wipe'
  | 'in'
  | 'out'
  | 'range'
  | 'pick'
  | 'focus'
  | 'pin'
  | 'paint'
  | 'region'
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
  label: string;
  icon: LucideIcon;
  /** Raccourci clavier — repris dans l'infobulle et à droite du libellé, rail déplié. */
  key: string;
  hint: string;
  /** Restreint l'outil à un type de média (les outils de sélection sont propres au splat). */
  kind?: MediaKind;
}

/** Action de vue du bas du rail : ne change pas l'outil armé, agit tout de suite. */
export interface ViewAction {
  id: 'fit' | 'reset';
  icon: LucideIcon;
  label: string;
  key: string;
}

export const DEFAULT_TOOL: ToolId = 'nav';

const NAV_HINT_MEDIA = 'Glisser pour déplacer l’image · molette pour zoomer';
const NAV_HINT_SPATIAL = 'Orbite au glisser · vol libre au clic droit · zoom à la molette';

const nav = (hint: string): ReviewTool => ({
  id: 'nav',
  label: 'Naviguer',
  icon: Hand,
  key: 'V',
  hint,
});

const ZOOM: ReviewTool = {
  id: 'zoom',
  label: 'Zoom',
  icon: ZoomIn,
  key: 'Z',
  hint: 'Glisser pour zoomer, Alt pour dézoomer',
};

/** Outils de tracé du mode « Annoter » — vidéo et image. */
export const DRAW_TOOLS: ReviewTool[] = [
  { id: 'draw', label: 'Dessin libre', icon: Pencil, key: 'D', hint: 'Trait à main levée' },
  { id: 'rect', label: 'Rectangle', icon: Square, key: 'R', hint: 'Encadrer une zone' },
  { id: 'ellipse', label: 'Ellipse', icon: Circle, key: 'E', hint: 'Cercler un détail' },
  { id: 'arrow', label: 'Flèche', icon: MoveUpRight, key: 'A', hint: 'Pointer un élément' },
  {
    id: 'polygon',
    label: 'Polygone',
    icon: Hexagon,
    key: 'G',
    hint: 'Clic par sommet, double-clic pour fermer',
  },
  { id: 'text', label: 'Texte', icon: Type, key: 'T', hint: 'Poser une étiquette' },
  {
    id: 'shape-move',
    label: 'Déplacer une forme',
    icon: Move,
    key: 'M',
    hint: 'Reprendre une forme déjà posée',
  },
  { id: 'erase', label: 'Gomme', icon: Eraser, key: 'X', hint: 'Clic ou glisser pour effacer' },
];

function mediaTools(mode: ModeId, kind: MediaKind): ReviewTool[] {
  const start = nav(NAV_HINT_MEDIA);
  if (mode === 'annotate') return [start, ...DRAW_TOOLS];
  if (mode === 'compare')
    return [
      start,
      {
        id: 'wipe',
        label: 'Barre de wipe',
        icon: MoveHorizontal,
        key: 'W',
        hint: 'Glisser la barre · clic droit pour la faire pivoter',
      },
      ZOOM,
    ];
  if (mode === 'edit')
    return kind === 'VIDEO'
      ? [
          start,
          {
            id: 'in',
            label: 'Point d’entrée',
            icon: LogIn,
            key: 'I',
            hint: 'Cale l’entrée sur la frame courante',
          },
          {
            id: 'out',
            label: 'Point de sortie',
            icon: LogOut,
            key: 'O',
            hint: 'Cale la sortie sur la frame courante',
          },
          {
            id: 'range',
            label: 'Plage d’annotation',
            icon: Ruler,
            key: 'P',
            hint: 'Glisser sur la timeline pour couvrir plusieurs frames',
          },
        ]
      : [
          start,
          {
            id: 'pick',
            label: 'Pipette',
            icon: Pipette,
            key: 'P',
            hint: 'Lire la valeur d’un pixel (linéaire et affichage)',
          },
          ZOOM,
        ];
  return [start, ZOOM];
}

const FOCUS: ReviewTool = {
  id: 'focus',
  label: 'Mise au point',
  icon: Crosshair,
  key: 'C',
  kind: 'SPLAT',
  hint: 'Cliquer un point du splat pour y régler la distance focale',
};

const SPATIAL_TOOLS: Record<string, ReviewTool[]> = {
  explore: [
    nav(NAV_HINT_SPATIAL),
    FOCUS,
    {
      id: 'pin',
      label: 'Point d’intérêt',
      icon: MapPin,
      key: 'I',
      hint: 'Poser un repère nommé, visible par tous',
    },
  ],
  annotate: [
    nav(NAV_HINT_SPATIAL),
    {
      id: 'paint',
      label: 'Pinceau 3D',
      icon: Brush,
      key: 'P',
      hint: 'Peindre sur la surface — les traits partent avec le commentaire',
    },
    {
      id: 'region',
      label: 'Zone',
      icon: SquareDashed,
      key: 'B',
      hint: 'Encadrer une zone de l’écran pour la pièce jointe du commentaire',
    },
    {
      id: 'pin',
      label: 'Épingle',
      icon: MapPin,
      key: 'I',
      hint: 'Ancrer le commentaire à un point de la surface',
    },
  ],
  stage: [
    nav(NAV_HINT_SPATIAL),
    {
      id: 'cam-move',
      label: 'Poser la caméra',
      icon: Move3d,
      key: 'T',
      hint: 'Déplacer la caméra-objet dans la scène',
    },
    {
      id: 'cam-aim',
      label: 'Orienter la caméra',
      icon: Rotate3d,
      key: 'R',
      hint: 'Orienter le regard de la caméra-objet',
    },
    { ...FOCUS, hint: 'Régler la distance focale au clic' },
  ],
  clean: [
    nav(NAV_HINT_SPATIAL),
    {
      id: 'sel-rect',
      label: 'Rectangle',
      icon: SquareDashed,
      key: 'B',
      kind: 'SPLAT',
      hint: 'Sélection rectangle — Maj ajoute, Alt retire',
    },
    {
      id: 'sel-lasso',
      label: 'Lasso',
      icon: Lasso,
      key: 'L',
      kind: 'SPLAT',
      hint: 'Sélection lasso — Maj ajoute, Alt retire',
    },
    {
      id: 'sel-brush',
      label: 'Pinceau surface',
      icon: Brush,
      key: 'P',
      kind: 'SPLAT',
      hint: 'Ne prend que les splats de surface — Maj ajoute, Alt retire',
    },
    {
      id: 'volume',
      label: 'Volume de coupe',
      icon: BoxSelect,
      key: 'O',
      kind: 'SPLAT',
      hint: 'Boîte ou sphère : creuser ou isoler',
    },
    { id: 'translate', label: 'Déplacer', icon: Move3d, key: 'T', hint: 'Gizmo de translation' },
    { id: 'rotate', label: 'Tourner', icon: Rotate3d, key: 'R', hint: 'Gizmo de rotation' },
    { id: 'scale', label: 'Échelle', icon: Scale3d, key: 'S', hint: 'Gizmo d’échelle' },
  ],
};

/** Outils du mode actif, filtrés par type de média. */
export function toolsFor(mode: ModeId, kind: MediaKind): ReviewTool[] {
  const tools = isSpatialKind(kind) ? (SPATIAL_TOOLS[mode] ?? []) : mediaTools(mode, kind);
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
  { id: 'fit', icon: Frame, label: 'Cadrer la sélection ou l’objet', key: 'F' },
  { id: 'reset', icon: Home, label: 'Vue d’origine', key: 'H' },
];

const MEDIA_ACTIONS: ViewAction[] = [
  { id: 'fit', icon: Maximize2, label: 'Ajuster à l’écran', key: 'F' },
  { id: 'reset', icon: Scan, label: 'Taille réelle 1:1', key: 'H' },
];

/** Actions de vue du bas du rail, après le séparateur. */
export function viewActionsFor(kind: MediaKind): ViewAction[] {
  return isSpatialKind(kind) ? SPATIAL_ACTIONS : MEDIA_ACTIONS;
}
