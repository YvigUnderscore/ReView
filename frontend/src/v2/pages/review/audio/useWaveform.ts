// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../../lib/apiClient';
import { qk } from '../../../lib/query';
import { decodeWaveformPeaks, type WaveformMeta } from './waveformData';

/** Réponse du média, réduite au seul champ qui nous intéresse (cache partagé avec la review). */
interface MediaWaveformResp {
  waveform?: WaveformMeta | null;
}

const STORAGE_KEY = 'review:video:waveform';

const loadVisible = (): boolean => {
  try {
    return localStorage.getItem(STORAGE_KEY) !== '0';
  } catch {
    return true;
  }
};

export interface WaveformTrack {
  /** Le média porte une forme d'onde (transcodé avec du son). */
  available: boolean;
  /** Crêtes prêtes à dessiner — `null` tant qu'elle est absente ou masquée. */
  peaks: Uint8Array | null;
  visible: boolean;
  toggle: () => void;
}

/**
 * Forme d'onde du média courant (constat vague 5 : rien n'existait côté son).
 *
 * Elle voyage dans la réponse `/api/media/:id` déjà chargée par la review — même clé de
 * cache, `staleTime` infini : aucune requête supplémentaire, aucun décodage audio dans
 * le navigateur. Masquable, et le choix se retient d'un média à l'autre.
 */
export function useWaveform(mediaId: number): WaveformTrack {
  const [visible, setVisible] = useState(loadVisible);
  const q = useQuery({
    queryKey: qk.media(mediaId),
    queryFn: () => api.get<MediaWaveformResp>(`/api/media/${mediaId}`),
    staleTime: Infinity,
    enabled: mediaId > 0,
  });
  const peaks = useMemo(() => decodeWaveformPeaks(q.data?.waveform), [q.data?.waveform]);

  const toggle = useCallback(() => {
    setVisible((v) => {
      const next = !v;
      try {
        localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
      } catch {
        // Stockage indisponible (navigation privée) : choix de session seulement.
      }
      return next;
    });
  }, []);

  return { available: peaks !== null, peaks: visible ? peaks : null, visible, toggle };
}
