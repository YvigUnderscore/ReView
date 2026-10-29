// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect } from 'react';
import { getSocket } from '@/lib/socket';
import { clearPointers, setPointerEmitter } from './pointerBus';

/**
 * Broadcasts the driver's cursor on the existing `live:sync` channel.
 *
 * The rate is that of the bus (~20 Hz), deliberately decoupled from `syncHz`: the periodic
 * broadcast, set to 2 Hz by default, would make a pointer jump from one end of the image to the
 * other. The frame is light (identifier + two fractions) and the viewers apply it on their own:
 * no other field accompanies the cursor.
 *
 * Taking over clears the received cursors: we are the ones pointing now.
 */
export function usePointerBroadcast({
  active,
  isDriver,
  sessionKey,
  selfId,
  mediaId,
}: {
  active: boolean;
  isDriver: boolean;
  sessionKey: string;
  selfId: number;
  mediaId: number;
}): void {
  useEffect(() => {
    if (!active) clearPointers();
    if (!active || !isDriver) return;
    clearPointers();
    setPointerEmitter((frame) => {
      getSocket().emit('live:sync', sessionKey, {
        mediaId,
        pointer: frame ? { userId: selfId, x: frame.x, y: frame.y } : { userId: selfId, gone: true },
      });
    });
    return () => setPointerEmitter(null);
  }, [active, isDriver, sessionKey, selfId, mediaId]);
}
