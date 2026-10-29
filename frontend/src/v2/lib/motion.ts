// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Variants, Transition } from 'framer-motion';

/**
 * Shared motion constants (10.B6). Durations ≤ 300 ms, standard easing.
 * Respect for `prefers-reduced-motion` is ensured in components via
 * `useReducedMotion()` (framer) or the Tailwind `motion-reduce:` variant.
 */
export const DURATION = { fast: 0.15, base: 0.2, slow: 0.3 } as const;

/** Soft "ease-out" easing, consistent across all entrance transitions. */
export const EASE_OUT = [0.16, 1, 0.3, 1] as const;

export const transition: Transition = { duration: DURATION.base, ease: EASE_OUT };

/** Appearance of an element (slight fade + rise). */
export const fadeInUp: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition },
};

/** Container orchestrating the cascading entrance of its children (30 ms stagger). */
export const staggerContainer: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.03 } },
};
