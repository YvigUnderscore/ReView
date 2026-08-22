// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect } from 'react';
import { getSocket } from '../../../../lib/socket';
import { clearPointers, setPointerEmitter } from './pointerBus';

/**
 * Diffusion du curseur du driver sur le canal `live:sync` existant.
 *
 * La cadence est celle du bus (~20 Hz), volontairement décorrélée de `syncHz` : la
 * diffusion périodique, réglée à 2 Hz par défaut, ferait un pointeur qui saute d'un bout
 * à l'autre de l'image. La trame est légère (identifiant + deux fractions) et les
 * spectateurs l'appliquent seule — aucun autre champ n'accompagne le curseur.
 *
 * Prendre la main efface les curseurs reçus : c'est nous qui montrons désormais.
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
