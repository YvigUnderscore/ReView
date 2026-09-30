// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { getSocket } from '../../../lib/socket';
import type { ImageView } from '../../components/ImageReviewViewer';

/**
 * Types et helpers de la session live (33.B) — partagés par `useLiveSession` (extraits
 * pour le budget de 300 lignes). État module : départs différés + dernier média du driver.
 */

/** Participant d'une session live (payload socket `live:state`). */
export interface LiveParticipant {
  id: number;
  displayName: string;
  initials: string;
  avatarUrl: string | null;
}

export interface LiveStatePayload {
  key: string;
  pilotId: number;
  coHostIds: number[];
  /** Pilote ou co-pilote dont la diffusion fait foi (dernier à avoir interagi). */
  driverId: number;
  participants: LiveParticipant[];
}

/** État diffusé par le driver — appliqué tel quel par les spectateurs. */
export interface LiveSyncPayload {
  mediaId: number;
  t?: number;
  playing?: boolean;
  camera?: unknown;
  compareId?: number | null;
  /** Mode de comparaison (côte-à-côte / wipe / diff 34.E) + barre de wipe (retours 33). */
  compareMode?: 'side' | 'wipe' | 'diff';
  wipe?: { pos: number; angle: number };
  imageView?: ImageView;
  /** Interaction explicite (play/seek/navigation/zoom) — vaut prise de main d'un co-pilote. */
  action?: boolean;
}

/**
 * Départs différés par clé de session : la navigation interne (média suivant d'une
 * playlist) démonte puis remonte le hook — on n'émet `live:leave` que si aucun
 * nouveau montage n'a repris la session entre-temps (sinon le pilote perdrait la main).
 */
const pendingLeaves = new Map<string, number>();

export const cancelPendingLeave = (key: string): void => {
  const t = pendingLeaves.get(key);
  if (t !== undefined) {
    window.clearTimeout(t);
    pendingLeaves.delete(key);
  }
};

export const schedulePendingLeave = (key: string): void => {
  cancelPendingLeave(key);
  pendingLeaves.set(
    key,
    window.setTimeout(() => {
      pendingLeaves.delete(key);
      getSocket().emit('live:leave', key);
    }, 1500),
  );
};

/** Dernier média imposé par le driver — distingue navigation suivie / navigation locale. */
export const driverMedia = { lastId: 0 };
