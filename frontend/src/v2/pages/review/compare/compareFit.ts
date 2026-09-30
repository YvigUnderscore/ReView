// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createContext, useContext } from 'react';

/** Taille en pixels — zone disponible d'un pane, ou boîte d'affichage d'un média. */
export interface Size {
  w: number;
  h: number;
}

/** Une zone n'entre dans le calcul que mesurée : un pane pas encore mis en page vaut 0. */
const measured = (z: Size): boolean => z.w > 0 && z.h > 0;

/**
 * Boîte « contain » d'un média dans une zone : il remplit la zone sans la dépasser, **quelle
 * que soit sa résolution source**. C'est tout le remède au reproche de départ — la vidéo B
 * s'affichait à sa taille naturelle, minuscule au centre de sa moitié dès que le pane était
 * plus large qu'elle, et l'œil comparait deux tailles avant de comparer deux images.
 */
export function containBox(zone: Size, aspect: number): Size {
  if (!measured(zone) || !(aspect > 0)) return { w: 0, h: 0 };
  const h = Math.min(zone.h, zone.w / aspect);
  return { w: h * aspect, h };
}

/**
 * Zone commune à plusieurs panes : la plus petite largeur et la plus petite hauteur, donc le
 * rectangle qui tient dans **tous** les panes. En comparaison, chaque média s'ajuste dans
 * celle-là et non dans la sienne : le pane maître porte la timeline et le transport, les panes
 * B un en-tête ou un HUD — leurs zones n'ont jamais la même hauteur, et deux ajustements
 * « contain » chacun chez soi donnaient deux tailles d'affichage différentes.
 *
 * Les zones non mesurées sont ignorées : un pane qui vient de monter annonce 0 × 0, et le
 * minimum aurait écrasé l'affichage de tous les autres.
 */
export function commonZone(zones: Size[]): Size | null {
  const known = zones.filter(measured);
  if (known.length === 0) return null;
  return {
    w: Math.min(...known.map((z) => z.w)),
    h: Math.min(...known.map((z) => z.h)),
  };
}

/** Inscription de la zone mesurée d'un pane, ou retrait (`null`) quand le pane disparaît. */
export type PublishZone = (id: string, size: Size | null) => void;

/**
 * Deux contextes plutôt qu'un objet : l'inscription doit être **stable**. Portée par le même
 * objet que la zone commune, elle changeait d'identité à chaque mesure — l'effet qui inscrit
 * se rejouait, se désinscrivait, se réinscrivait, et la boucle ne s'arrêtait jamais.
 *
 * Exportés pour le seul `CompareFitProvider`, qui les alimente : les panes, eux, passent par
 * les deux hooks ci-dessous. Le provider vit dans son propre fichier — un module qui exporte
 * un composant n'a pas le droit d'exporter aussi des fonctions (Fast Refresh).
 */
export const PublishContext = createContext<PublishZone | null>(null);
export const ZoneContext = createContext<Size | null>(null);

/** Inscription du pane courant, `null` hors d'un `CompareFitProvider`. */
export function useCompareFitPublish(): PublishZone | null {
  return useContext(PublishContext);
}

/** Zone commune au groupe de panes, `null` hors provider ou tant qu'aucun n'est mesuré. */
export function useCompareFitZone(): Size | null {
  return useContext(ZoneContext);
}
