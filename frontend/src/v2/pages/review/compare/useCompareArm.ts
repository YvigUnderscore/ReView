// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef } from 'react';
import { DEFAULT_MODE, type ModeId } from '../chrome/modes';
import type { CompareMode } from '../useCompareState';

/**
 * Relie le mode « Compare » de la bascule à l'état de comparaison.
 *
 * Les deux vivaient côte à côte sans se parler : armer le segment ne choisissait aucun média
 * B, et la barre de wipe ne s'affichait donc jamais. Tout passe par `useCompareState` pour
 * que le spectateur d'une session live voie la même chose que le pilote.
 *
 * Trois règles, et leurs réciproques :
 *   1. entrer en comparaison arme le wipe et prend le premier média comparable ;
 *   2. en sortir ferme la comparaison ;
 *   3. un B choisi ailleurs (en-tête vidéo, session live) arme le mode ; le fermer en sort.
 */
export function useCompareArm({
  mode,
  onMode,
  hasB,
  firstB,
  onSetB,
  onClear,
  onCompareMode,
}: {
  mode: ModeId;
  onMode: (mode: ModeId) => void;
  hasB: boolean;
  /** Premier média comparable connu, null tant qu'il n'est pas chargé. */
  firstB: number | null;
  onSetB: (mediaId: number) => void;
  onClear: () => void;
  onCompareMode: (mode: CompareMode) => void;
}) {
  const prevMode = useRef(mode);
  const hadB = useRef(hasB);
  const picked = useRef(false);
  // Le mode vient d'être armé par la règle 3, non par l'utilisateur : la vidéo qui coche deux
  // versions d'un coup veut sa grille 2×2, pas un wipe qu'on lui imposerait au passage.
  const fromB = useRef(false);

  useEffect(() => {
    const was = prevMode.current;
    if (was === mode) return;
    prevMode.current = mode;
    if (mode === 'compare') {
      if (!fromB.current) onCompareMode('wipe');
      fromB.current = false;
    } else if (was === 'compare' && hasB) onClear();
  }, [mode, hasB, onCompareMode, onClear]);

  useEffect(() => {
    const had = hadB.current;
    hadB.current = hasB;
    if (hasB && !had && mode !== 'compare') {
      fromB.current = true;
      onMode('compare');
    } else if (!hasB && had && mode === 'compare') onMode(DEFAULT_MODE);
  }, [hasB, mode, onMode]);

  // Armé sans B : le premier média comparable est pris d'office, une fois — sans lui la barre
  // de wipe n'aurait rien à découvrir. `picked` évite de le reprendre après une fermeture.
  useEffect(() => {
    if (mode !== 'compare') {
      picked.current = false;
      return;
    }
    if (hasB || picked.current || firstB == null) return;
    picked.current = true;
    onSetB(firstB);
  }, [mode, hasB, firstB, onSetB]);
}
