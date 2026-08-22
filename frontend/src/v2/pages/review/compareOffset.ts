// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { create } from 'zustand';

/**
 * Décalage temporel de la comparaison A/B, en frames.
 *
 * Les panes B recopiaient le temps du maître à l'identique. C'est le bon réglage quand les
 * deux versions partagent le même conform — et le mauvais dès qu'il y a eu un retime, une
 * poignée rallongée ou un point d'entrée déplacé entre la v02 et la v03. Le superviseur qui
 * vérifie un raccord voyait alors deux images qui ne se correspondent pas, sans moyen de les
 * recaler autrement qu'en renonçant à la synchronisation.
 *
 * Le décalage vit ici, hors de l'arbre React : `useVideoSync` le lit pour chaque pane
 * esclave, les raccourcis du lecteur l'ajustent. Il vaut pour tous les panes B — un décalage
 * par pane demanderait de le hisser dans `useCompareState`, ce que la grille 2×2 justifiera
 * le jour où l'on comparera trois conforms différents à la fois.
 */

/** Bornes : au-delà de dix secondes de décalage, ce n'est plus un recalage de conform. */
export const MAX_COMPARE_OFFSET_FRAMES = 240;

/** Ramène un décalage dans les bornes, à la frame entière. */
export function clampOffsetFrames(frames: number): number {
  if (!Number.isFinite(frames)) return 0;
  return Math.max(-MAX_COMPARE_OFFSET_FRAMES, Math.min(MAX_COMPARE_OFFSET_FRAMES, Math.round(frames)));
}

interface CompareOffsetState {
  /** Décalage courant, en frames — positif : la version B est en avance sur la A. */
  frames: number;
  /** Le même décalage en secondes, seule unité que connaisse un `HTMLVideoElement`. */
  seconds: number;
  /** Ajoute `delta` frames au décalage courant, à la cadence donnée. */
  nudge: (delta: number, fps: number) => void;
  /** Fixe le décalage (utilisé par les tests et par une éventuelle saisie directe). */
  set: (frames: number, fps: number) => void;
  reset: () => void;
}

const seconds = (frames: number, fps: number): number => (Number.isFinite(fps) && fps > 0 ? frames / fps : 0);

export const useCompareOffset = create<CompareOffsetState>((setState) => ({
  frames: 0,
  seconds: 0,
  nudge: (delta, fps) =>
    setState((s) => {
      const frames = clampOffsetFrames(s.frames + delta);
      return { frames, seconds: seconds(frames, fps) };
    }),
  set: (frames, fps) => {
    const clamped = clampOffsetFrames(frames);
    setState({ frames: clamped, seconds: seconds(clamped, fps) });
  },
  reset: () => setState({ frames: 0, seconds: 0 }),
}));
