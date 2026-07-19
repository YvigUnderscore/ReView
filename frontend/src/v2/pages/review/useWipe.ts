import { useState } from 'react';
import { wipeClipPath } from './wipe';

/**
 * Position/angle du wipe hissés par l'orchestrateur (session live, retours 33) : le
 * driver diffuse pos/angle, les spectateurs les appliquent. `onGrab` (optionnel) est
 * appelé à la prise d'une poignée — prise de main d'un co-pilote.
 */
export interface WipeShared {
  pos: number;
  angle: number;
  setPos: (pos: number) => void;
  setAngle: (angle: number) => void;
  onGrab?: () => void;
}

/** État partagé du wipe (position 0..1, angle, taille du conteneur) + clip-path du média B. */
export function useWipe(shared?: WipeShared) {
  const [localPos, setLocalPos] = useState(0.5);
  const [localAngle, setLocalAngle] = useState(0);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const pos = shared?.pos ?? localPos;
  const angle = shared?.angle ?? localAngle;
  const setPos = shared?.setPos ?? setLocalPos;
  const setAngle = shared?.setAngle ?? setLocalAngle;
  const clipPath = wipeClipPath(pos, angle, size.w || 1, size.h || 1);
  return { pos, setPos, angle, setAngle, size, setSize, clipPath, onGrab: shared?.onGrab };
}
