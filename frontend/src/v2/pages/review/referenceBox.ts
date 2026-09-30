// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/** Boîte d'une image de référence épinglée au canvas, en fractions de l'image de base. */
export interface RefBox {
  x: number;
  y: number;
  width: number;
}

/** Image de référence en préparation dans le composer (locale, envoyée avec le commentaire). */
export interface StagedReference extends RefBox {
  key: string;
  dataUrl: string;
}

/**
 * Bandes libres autour du média quand il est ajusté au viewer (letterbox), en fractions de la
 * largeur/hauteur du média. Mesurées sur les aspects, donc indépendantes du zoom courant.
 *
 * Elles ne bornent **plus** le geste : une référence se pose exactement là où on la lâche
 * (`placeRefBox`). Elles décrivent la zone que tout viewer montre à l'ajustement, et servent à
 * deux choses seulement — choisir où tombe un collage, et rattraper à l'affichage une position
 * héritée qu'aucun viewer ne montrerait (`rescueRefBox`).
 */
export interface ViewerBands {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Aucune bande connue (conteneur pas encore mesuré) : on s'en tient au cadre du média. */
export const NO_BANDS: ViewerBands = { left: 0, right: 0, top: 0, bottom: 0 };

export const REF_MIN_WIDTH = 0.02;
const REF_MAX_WIDTH = 1;
/** Largeur d'une référence au collage (fraction de la largeur du média). */
export const REF_PASTE_WIDTH = 0.3;
/**
 * Débordement maximal autorisé autour du média, en largeurs/hauteurs d'image — **miroir du
 * bornage Zod** (`media-reference.routes.ts`). Seule limite du geste : au-delà, le serveur
 * refuserait la référence à l'envoi et le commentaire la perdrait.
 */
export const REF_POS_LIMIT = 3;
/** Bande haute de la référence tenue pour visible : sa hauteur, elle, est inconnue ici. */
const REF_MIN_VISIBLE = 0.05;
/** Part de la largeur qui doit rester dans la zone pour qu'on reconnaisse la référence. */
const REF_MIN_SHOWN = 1 / 3;
/** Respiration entre le média et une référence posée dans une bande. */
const REF_GAP = 0.02;
/** Décalage des références suivantes, le long de la bande ou en diagonale sur le média. */
const CASCADE = 0.05;
const CORNER = 0.04;

const clamp = (v: number, lo: number, hi: number) =>
  Number.isFinite(v) ? Math.min(Math.max(v, lo), hi) : lo;

/** Coordonnée exploitable : un conteneur non mesuré produit un `NaN` à chaque `pointermove`. */
const finite = (v: number) => (Number.isFinite(v) ? v : 0);

/** Bande exploitable : jamais négative, jamais au-delà du plafond atteignable. */
const band = (v: number) => clamp(v, 0, REF_POS_LIMIT);

/** Bord opposé d'une bande. Sans bande, `0` franc : un `-0` survit aux comparaisons. */
const edge = (v: number) => (v === 0 ? 0 : -v);

/**
 * Bandes du letterbox à partir des deux aspects (média, zone qui le rogne). Un média plus
 * « large » que le viewer laisse des bandes haut/bas, un média plus « haut » des bandes
 * latérales. Aspect non mesurable (conteneur de hauteur nulle) ⇒ aucune bande.
 */
export function fitBands(mediaAspect: number, viewportAspect: number): ViewerBands {
  const ok = (v: number) => Number.isFinite(v) && v > 0;
  if (!ok(mediaAspect) || !ok(viewportAspect)) return NO_BANDS;
  if (viewportAspect > mediaAspect) {
    const side = band((viewportAspect / mediaAspect - 1) / 2);
    return { left: side, right: side, top: 0, bottom: 0 };
  }
  const vert = band((mediaAspect / viewportAspect - 1) / 2);
  return { left: 0, right: 0, top: vert, bottom: vert };
}

/**
 * Pose une référence **là où on la lâche**, dedans comme dehors du cadre du média : rien ne la
 * ramène vers l'image. Seuls sont corrigés les accidents — un `NaN` venu d'un conteneur non
 * mesuré, une largeur absurde, et le débordement au-delà du plafond partagé avec le serveur
 * (au-delà, l'envoi du commentaire serait refusé : c'est là qu'on perdrait la référence).
 *
 * Trois bornages « intelligents » ont échoué à laisser le geste libre : hors cadre sans limite
 * (invisible), puis 0..1 (collée d'office sur l'image), puis les bandes du letterbox — qui
 * interdisent encore les côtés dès que le letterbox est horizontal, soit le cas courant d'un
 * plan large. Le geste n'est donc plus borné du tout ; le filet est à l'affichage.
 */
export function placeRefBox(box: RefBox): RefBox {
  return {
    x: clamp(finite(box.x), -REF_POS_LIMIT, REF_POS_LIMIT),
    y: clamp(finite(box.y), -REF_POS_LIMIT, REF_POS_LIMIT),
    width: clamp(box.width, REF_MIN_WIDTH, REF_MAX_WIDTH),
  };
}

/** Intervalle jamais vide : une zone dégénérée ne doit pas renvoyer un `NaN`. */
const within = (v: number, lo: number, hi: number) => clamp(v, lo, Math.max(lo, hi));

/**
 * Zone que le viewer montre réellement, en fractions du média — mesurée en pixels, donc juste
 * au zoom et au pan courants. C'est « le canevas » du point de vue de qui déplace une référence.
 */
export interface RefCanvas {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Faute de mesure, le cadre du média pour seul canvas : c'est le comportement prudent. */
export const MEDIA_CANVAS: RefCanvas = { left: 0, top: 0, right: 1, bottom: 1 };

/**
 * Borne un geste au **canvas visible** : la référence se pose où on veut dessus, dedans comme
 * dehors du cadre du média, mais pas au-delà du viewer. Poussée dehors elle deviendrait
 * insaisissable — le viewer rogne ce qui dépasse, survol compris : plus moyen ni de la reprendre
 * ni de la supprimer avant l'envoi du commentaire. C'est là le seul « on ne doit pas pouvoir la
 * perdre », et il ne contrarie aucun geste : on ne lâche jamais le pointeur hors de ce qu'on voit.
 *
 * `height` est la hauteur rendue de la référence en fractions de la hauteur du média (l'image
 * est décodée, on la mesure) ; inconnue, on s'en tient à la part attrapable.
 */
export function onCanvasRefBox(box: RefBox, height: number, canvas: RefCanvas): RefBox {
  const placed = placeRefBox(box);
  const tall = Number.isFinite(height) && height > 0 ? height : REF_MIN_VISIBLE;
  const holdX = Math.min(placed.width, REF_MIN_VISIBLE);
  const holdY = Math.min(tall, REF_MIN_VISIBLE);
  return {
    ...placed,
    x: within(placed.x, canvas.left - placed.width + holdX, canvas.right - holdX),
    y: within(placed.y, canvas.top - tall + holdY, canvas.bottom - holdY),
  };
}

/** Fenêtre d'un axe : ce qu'on garde tel quel, et où l'on ramène ce qui est hors champ. */
interface Axis {
  keepLo: number;
  keepHi: number;
  safeLo: number;
  safeHi: number;
}

const rescueAxis = (v: number, a: Axis) =>
  v >= a.keepLo && v <= a.keepHi ? v : within(v, a.safeLo, a.safeHi);

/**
 * Filet d'affichage : une référence dont on voit assez reste **exactement** où elle a été
 * posée ; une autre est ramenée dans la zone que ce viewer montre à l'ajustement (le média plus
 * ses bandes). Le collage posait autrefois à x = 1.05 sans bornage : de telles positions, hors
 * de toute bande, existent en base et resteraient invisibles.
 *
 * Réservé aux références **persistées**, qu'on ne peut plus déplacer. Celles en préparation
 * viennent d'être lâchées sous les yeux de leur auteur : rien ne les recadre.
 */
export function rescueRefBox(box: RefBox, bands: ViewerBands = NO_BANDS): RefBox {
  const { x, y, width } = placeRefBox(box);
  const minX = edge(band(bands.left));
  const maxX = 1 + band(bands.right);
  const minY = edge(band(bands.top));
  const maxY = 1 + band(bands.bottom);
  // Largeur connue : on exige d'en voir une part reconnaissable. Hauteur inconnue : seule la
  // bande haute de la référence est sûre d'exister, c'est elle qui doit rester dans la zone.
  const shown = Math.min(width, Math.max(REF_MIN_VISIBLE, width * REF_MIN_SHOWN));
  return {
    x: rescueAxis(x, {
      keepLo: minX - width + shown,
      keepHi: maxX - shown,
      safeLo: minX,
      safeHi: maxX - width,
    }),
    y: rescueAxis(y, {
      keepLo: minY - REF_MIN_VISIBLE,
      keepHi: maxY - REF_MIN_VISIBLE,
      safeLo: minY,
      safeHi: maxY - REF_MIN_VISIBLE,
    }),
    width,
  };
}

/**
 * Position d'une référence qu'on vient de coller : **à côté** du média dès qu'une bande du
 * letterbox peut l'accueillir — comparer suppose de voir les deux images — sinon sur un coin du
 * média, seul endroit visible quand le média remplit le viewer. Le geste n'étant plus borné,
 * cette position n'est qu'un point de départ.
 *
 * Une bande latérale se juge sur la largeur, connue. Faute de connaître la hauteur de la
 * référence (l'image n'est pas décodée au collage), une bande haut/bas se juge sur cette même
 * largeur : exact pour un média carré, un peu optimiste pour un plan large. Les collages
 * suivants cascadent le long de la bande retenue.
 */
export function pastedRefBox(index: number, bands: ViewerBands = NO_BANDS): RefBox {
  const width = REF_PASTE_WIDTH;
  const need = width + 2 * REF_GAP;
  const fits = (v: number) => band(v) >= need;
  const along = REF_GAP + index * CASCADE;
  if (fits(bands.right) || fits(bands.left)) {
    const x = fits(bands.right) ? 1 + REF_GAP : -(width + REF_GAP);
    return placeRefBox({ x, y: along, width });
  }
  if (fits(bands.bottom) || fits(bands.top)) {
    const y = fits(bands.bottom) ? 1 + REF_GAP : -(width + REF_GAP);
    return placeRefBox({ x: along, y, width });
  }
  return placeRefBox({ x: 0.06 + index * CORNER, y: 0.08 + index * CORNER, width });
}
