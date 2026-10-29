// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { wipeClipPath } from './wipe';

/**
 * Wipe position/angle lifted into the orchestrator (live session, feedback 33): the driver broadcasts
 * position/angle, the viewers apply them. `onGrab` (optional) is called when a handle is grabbed — a
 * co-pilot taking the hand.
 */
export interface WipeShared {
  pos: number;
  angle: number;
  setPos: (pos: number) => void;
  setAngle: (angle: number) => void;
  onGrab?: () => void;
}

/** Shared state of the wipe (position 0..1, angle, container size) + clip-path of media B. */
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
