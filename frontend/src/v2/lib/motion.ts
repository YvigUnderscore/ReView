// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Variants, Transition } from 'framer-motion';

/**
 * Constantes de motion partagées (10.B6). Durées ≤ 300 ms, easing standard.
 * Le respect de `prefers-reduced-motion` est assuré côté composants via
 * `useReducedMotion()` (framer) ou la variante Tailwind `motion-reduce:`.
 */
export const DURATION = { fast: 0.15, base: 0.2, slow: 0.3 } as const;

/** Easing « ease-out » doux, cohérent sur toutes les transitions d'entrée. */
export const EASE_OUT = [0.16, 1, 0.3, 1] as const;

export const transition: Transition = { duration: DURATION.base, ease: EASE_OUT };

/** Apparition d'un élément (léger fondu + montée). */
export const fadeInUp: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition },
};

/** Conteneur orchestrant l'apparition en cascade de ses enfants (stagger 30 ms). */
export const staggerContainer: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.03 } },
};
