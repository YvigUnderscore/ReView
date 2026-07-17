import { useState } from 'react';
import { wipeClipPath } from './wipe';

/** État partagé du wipe (position 0..1, angle, taille du conteneur) + clip-path du média B. */
export function useWipe() {
  const [pos, setPos] = useState(0.5);
  const [angle, setAngle] = useState(0);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const clipPath = wipeClipPath(pos, angle, size.w || 1, size.h || 1);
  return { pos, setPos, angle, setAngle, size, setSize, clipPath };
}
