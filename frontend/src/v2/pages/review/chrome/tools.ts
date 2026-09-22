// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  BoxSelect,
  Brush,
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
  MoveUpRight,
  Pencil,
  Rotate3d,
  Scale3d,
  Scan,
  SprayCan,
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
  | 'focus'
  | 'pin'
  | 'paint'
  | 'paint-erase'
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
    // qui cède. `P` est libre sur les médias plats — la brosse de surface la porte, mais
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
 *
 * La « Barre de wipe » (`W`) a été RETIRÉE au même titre (Phase 50, lot 12) : entrer en
 * comparaison **arme déjà le wipe** (`useCompareArm`), et la barre est alors à l'écran, avec
 * ses poignées de déplacement et de rotation. L'outil redisait donc le mode depuis le rail
 * sans rien armer de plus — aucun gestionnaire ne lisait cet identifiant. Le choix du mode de
 * comparaison (wipe, différence, côte-à-côte) reste à la barre d'options, qui seule l'exprime.
 */
function mediaTools(mode: ModeId): ReviewTool[] {
  const start = nav(NAV_HINT_MEDIA);
  if (mode === 'annotate') return [start, ...DRAW_TOOLS];
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
      // LA brosse de surface — **les deux types spatiaux** (Phase 50, lot 13). Elle portait
      // `kind: 'SPLAT'` depuis le lot 8, alors que la demande disait « dans les outils
      // d'annotation 3D/splat » : la restriction n'a pas fermé un trou, elle a acté un manque.
      // Sur un modèle, le mode « Annoter » n'offrait donc que la navigation et l'épingle. Le
      // geste, lui, ne demande rien de propre au nuage — un rayon vers une surface, un trait
      // en espace objet, une résolution d'écran : `paint/` ne connaît plus que la poignée de
      // scène commune (`viewer/sceneHandle`), que les deux viewers remplissent.
      //
      // ARBITRAGE d'icône — `Paintbrush` est, à 17 px, la même silhouette que `Pencil` : un
      // outil fin en diagonale. Or c'est exactement la confusion à lever (« bien différencier
      // la brush 2D/3D en terme d'icône »). `Brush` porte une tête large et une trace de
      // peinture : il se lit « posé SUR une surface », là où le crayon reste un tracé d'écran.
      // Le pinceau de sélection du masque garde `SprayCan` (cf. `clean`).
      //
      // `P` est libre sur cette liste : le pinceau de masque du mode « Nettoyer » répond à `M`,
      // et `toolSearchOrder` le cherche d'abord. Les deux pinceaux ne se disputent donc rien.
      id: 'paint',
      labelKey: 'tool.surfaceBrush',
      icon: Brush,
      key: 'P',
      hintKey: 'tool.surfaceBrush.hint',
    },
    {
      // Gomme de trait 3D : un clic retire le trait le plus proche — celui qu'on prépare, ou
      // celui d'un commentaire déjà envoyé dont on est l'auteur. `X` est la lettre de la gomme
      // des médias plats, et elle n'appartient pas à l'alphabet du vol (ZQSD/WASD + A/E).
      // Elle suit la brosse sur les deux types spatiaux : une brosse sans gomme laisse le seul
      // « tout effacer » comme retour en arrière, ce qui était le défaut d'avant le lot 8.
      id: 'paint-erase',
      labelKey: 'tool.strokeErase',
      icon: Eraser,
      key: 'X',
      hintKey: 'tool.strokeErase.hint',
    },
    // L'outil « Région » (`B`) a été RETIRÉ (Phase 50) : les deux viewers spatiaux le
    // masquaient du rail — il n'avait donc aucune implémentation nulle part — et la lettre
    // l'armait quand même au clavier.
    {
      // MÊME outil que dans « Explorer » : même libellé, même consigne, même geste. Il portait
      // ici son propre couple de clés (« Épingle » / « ancrer le commentaire à un point »), qui
      // décrivait un autre outil que le bouton d'à côté — un seul point d'intérêt, ancré au
      // commentaire, au lieu d'une liste numérotée posée au clic.
      id: 'pin',
      labelKey: 'tool.poi',
      icon: MapPin,
      key: 'I',
      hintKey: 'tool.poi.hint',
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
      // Pinceau de sélection : il marque les splats à masquer, d'où son nom et sa lettre
      // (`M`, le masque étant ce que « Nettoyer » écrit). Il a cédé `P` et l'icône de pinceau
      // à la brosse de surface du mode « Annoter » — cf. l'arbitrage noté là-bas. `M` ne
      // heurte rien en spatial et reste hors de l'alphabet du vol.
      id: 'sel-brush',
      labelKey: 'tool.maskBrush',
      icon: SprayCan,
      key: 'M',
      kind: 'SPLAT',
      hintKey: 'tool.maskBrush.hint',
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
 * Groupe du rail : les outils d'un mode, sous un titre, armant ce mode au clic.
 *
 * Le rail n'avait qu'une liste — celle du mode courant — et un mode absent de la bascule
 * d'en-tête devenait donc inatteignable à la souris. C'est ce qui est arrivé à l'édition du
 * nuage au lot 12 : le segment « Nettoyer » retiré, ses outils ont fini derrière un popover du
 * viewer, alors que la demande était de retirer le segment, pas de ranger les outils. Un second
 * groupe les ramène **à leur place**, sans rendre le segment.
 *
 * Le titre et les outils restent des données de `tools.ts` : le rail comme le clavier lisent
 * `toolsFor`, et un groupe ne peut donc rien offrir qui ne soit déjà un outil déclaré.
 */
export interface RailSection {
  /** Mode armé par un clic dans ce groupe. */
  mode: ModeId;
  titleKey: MessageKey;
  tools: ReviewTool[];
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
