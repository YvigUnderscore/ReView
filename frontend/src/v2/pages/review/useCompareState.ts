import { useState } from 'react';
import type { WipeShared } from './useWipe';

/**
 * Comparaison A/B hissée dans l'orchestrateur (retours 33) : média B, mode
 * (côte-à-côte / wipe) et barre de wipe — le driver d'une session live les diffuse,
 * les spectateurs les appliquent.
 */
export function useCompareState() {
  const [compareId, setCompareId] = useState<number | null>(null);
  const [compareMode, setCompareMode] = useState<'side' | 'wipe'>('side');
  const [wipePos, setWipePos] = useState(0.5);
  const [wipeAngle, setWipeAngle] = useState(0);

  /** Application d'une sync live (spectateur). */
  const applyWipe = (pos: number, angle: number) => {
    setWipePos(pos);
    setWipeAngle(angle);
  };

  /** État partagé consommé par les overlays de wipe ; `onGrab` = prise de main live. */
  const makeSharedWipe = (onGrab: () => void): WipeShared => ({
    pos: wipePos,
    angle: wipeAngle,
    setPos: setWipePos,
    setAngle: setWipeAngle,
    onGrab,
  });

  return {
    compareId,
    setCompareId,
    compareMode,
    setCompareMode,
    wipe: { pos: wipePos, angle: wipeAngle },
    applyWipe,
    makeSharedWipe,
  };
}
