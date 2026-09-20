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
 * Bandes libres autour du média quand il est ajusté au viewer (letterbox), en fractions de
 * la largeur/hauteur du média. C'est là qu'une référence se pose **à côté** de l'image sans
 * la recouvrir. Mesurées sur les aspects, donc indépendantes du zoom courant.
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
export const REF_MAX_WIDTH = 1;
/** Largeur d'une référence au collage (fraction de la largeur du média). */
export const REF_PASTE_WIDTH = 0.3;
/**
 * Débordement maximal autorisé autour du média, en largeurs/hauteurs d'image — **miroir du
 * bornage Zod** (`media-reference.routes.ts`). Au-delà, plus aucun viewer ne montre la
 * référence et personne ne peut la rattraper : c'est le plafond de « reste atteignable ».
 */
export const REF_POS_LIMIT = 3;
/** Part du bord bas qui doit rester attrapable : la hauteur d'une référence est inconnue ici. */
const REF_MIN_VISIBLE = 0.05;
/** Respiration entre le média et une référence posée dans une bande. */
const REF_GAP = 0.02;
/** Décalage des références suivantes, dans la bande (vertical) ou sur le média (diagonal). */
const CASCADE = 0.05;
const CORNER = 0.04;

const clamp = (v: number, lo: number, hi: number) =>
  Number.isFinite(v) ? Math.min(Math.max(v, lo), hi) : lo;

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
 * Ramène une boîte dans la zone **atteignable** : le média (0..1) plus les bandes visibles
 * autour de lui. Sert aux deux bouts — à la pose et au déplacement (une référence posée à
 * côté de l'image y reste), et à l'**affichage** des positions héritées : le collage posait
 * à x = 1.05 quand rien ne bornait, et sans recadrage elles resteraient invisibles chez qui
 * n'a pas de bande à droite.
 *
 * Sans bandes mesurées, la zone se réduit au cadre du média : une référence ne se perd pas
 * faute de mesure.
 */
export function clampRefBox(box: RefBox, bands: ViewerBands = NO_BANDS): RefBox {
  const width = clamp(box.width, REF_MIN_WIDTH, REF_MAX_WIDTH);
  const minX = edge(band(bands.left));
  const minY = edge(band(bands.top));
  return {
    x: clamp(box.x, minX, Math.max(minX, 1 + band(bands.right) - width)),
    y: clamp(box.y, minY, Math.max(minY, 1 + band(bands.bottom) - REF_MIN_VISIBLE)),
    width,
  };
}

/**
 * Position d'une référence qu'on vient de coller. Elle se pose **à côté** du média dès qu'une
 * bande latérale peut l'accueillir (comparer suppose de voir les deux), en cascade verticale ;
 * sinon elle retombe sur le coin haut-gauche du média, en cascade diagonale.
 *
 * Seules les bandes latérales servent : leur hauteur est celle du viewer, une référence y tient
 * donc toujours, alors qu'une bande haut/bas se jugerait à la hauteur de la référence —
 * inconnue au collage (l'image n'est pas encore décodée).
 */
export function pastedRefBox(index: number, bands: ViewerBands = NO_BANDS): RefBox {
  const width = REF_PASTE_WIDTH;
  const need = width + 2 * REF_GAP;
  const side = band(bands.right) >= need ? 1 : band(bands.left) >= need ? -1 : 0;
  const box =
    side === 0
      ? { x: 0.06 + index * CORNER, y: 0.08 + index * CORNER, width }
      : {
          x: side > 0 ? 1 + REF_GAP : -(width + REF_GAP),
          y: REF_GAP + index * CASCADE,
          width,
        };
  return clampRefBox(box, bands);
}
