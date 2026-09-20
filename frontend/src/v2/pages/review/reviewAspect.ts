// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { DEFAULT_REVIEW_ASPECT } from './frameRect';

/**
 * Ratio du cadre de review d'un média spatial (3D, splat) — UNE règle, tenue ici.
 *
 * POURQUOI. Le cadre letterboxé tirait son aspect de la présentation caméra enregistrée, et
 * la présentation le recopiait de la caméra, qui le tenait… du défaut 16/9 : le ratio se
 * recopiait lui-même, et le premier enregistrement de mise en scène gelait 16/9 sans que
 * personne ne l'ait choisi. Le ratio vient désormais des réglages pipeline (résolution héritée
 * studio → projet → séquence → plan), servis par le détail du média (`deliveryAspect`).
 *
 * Un aspect DÉJÀ enregistré dans une présentation garde la priorité : le guide letterbox
 * ancre les annotations 2D normalisées, et changer le cadre d'un média déjà annoté déplacerait
 * à l'écran des annotations posées sur des reviews validées (`shapesOutsideFrame` avertit
 * l'auteur, il ne migre rien). Le ratio du projet est donc un DÉFAUT, pas une reprise en main.
 */
export interface ReviewAspectSources {
  /** Aspect gelé dans la présentation caméra enregistrée, s'il y en a une. */
  presentation?: number | null;
  /** Ratio de livraison hérité des réglages pipeline, servi par le détail du média. */
  delivery?: number | null;
}

export interface ReviewAspect {
  /** Ratio largeur/hauteur à appliquer au cadre. */
  value: number;
  /** Vrai quand il vient d'une présentation enregistrée — les réglages pipeline ne s'y appliquent plus. */
  frozen: boolean;
}

/** Un ratio n'est utilisable que fini et strictement positif (sinon : cadre de hauteur nulle). */
const usable = (v: number | null | undefined): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v > 0;

/** Ratio effectif du cadre de review et sa provenance. Pur. */
export function reviewAspect(sources: ReviewAspectSources): ReviewAspect {
  if (usable(sources.presentation)) return { value: sources.presentation, frozen: true };
  return { value: usable(sources.delivery) ? sources.delivery : DEFAULT_REVIEW_ASPECT, frozen: false };
}

/**
 * La même règle, prise sur un détail de média : c'est la forme qu'appellent les viewers
 * (pane, PiP, dock, scène). Passer par elle évite de recopier la cascade à chaque point de
 * consommation — c'est exactement cette recopie qui avait laissé le ratio se figer en 16/9.
 */
export function mediaReviewAspect(
  data:
    | { splatPresentation?: { camera?: { aspect?: number } } | null; deliveryAspect?: number | null }
    | null
    | undefined,
): ReviewAspect {
  return reviewAspect({
    presentation: data?.splatPresentation?.camera?.aspect,
    delivery: data?.deliveryAspect,
  });
}

/** Formats nommés — un ratio se lit mieux « 2.39:1 » que « 2.39 ». */
const NAMED: [number, string][] = [
  [16 / 9, '16:9'],
  [2.39, '2.39:1'],
  [1.85, '1.85:1'],
  [4 / 3, '4:3'],
  [1, '1:1'],
];

/**
 * Ratio en texte pour l'écran. La tolérance couvre les résolutions réelles d'un pipeline :
 * 2048×858 n'est pas exactement 2.39 et se lit quand même « 2.39:1 ».
 */
export function reviewAspectLabel(aspect: number): string {
  const a = usable(aspect) ? aspect : DEFAULT_REVIEW_ASPECT;
  return NAMED.find(([v]) => Math.abs(v - a) < 0.01)?.[1] ?? `${a.toFixed(2)}:1`;
}
