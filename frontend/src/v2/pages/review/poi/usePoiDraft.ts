// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { MAX_COMMENT_ATTACHMENTS } from '../../../../lib/commentAttachments';
import type { Hotspot3D } from '../reviewTypes';
import { MAX_POI_POINTS } from './poiPoints';
import { t } from '../../../i18n';

/** Point d'intérêt en cours de rédaction : les images sont encore des fichiers locaux. */
export interface PoiDraft {
  /** Identité stable d'une rangée du composeur (les numéros, eux, bougent à chaque retrait). */
  key: string;
  position: string;
  normal: string;
  space?: 'object';
  text: string;
  files: File[];
}

export interface PoiDraftState {
  points: PoiDraft[];
  /** Point mis en avant : rangée du composeur et pastille de la scène le signalent ensemble. */
  activeKey: string | null;
  setActiveKey: (key: string | null) => void;
  /** Pose un point de plus, à la suite — c'est le rang qui donne son numéro. */
  add: (hotspot: Hotspot3D) => void;
  /** Repose le point de rang `index` ailleurs (pastille déplacée dans la scène). */
  move: (index: number, hotspot: Hotspot3D) => void;
  remove: (key: string) => void;
  setText: (key: string, text: string) => void;
  addFiles: (key: string, files: File[]) => void;
  removeFile: (key: string, index: number) => void;
  clear: () => void;
}

const newKey = () => Math.random().toString(36).slice(2, 9);

/**
 * Points d'intérêt du composeur : posés, numérotés, déplaçables et supprimables **tant que le
 * commentaire n'est pas envoyé**. L'envoi les emporte tous dans un seul commentaire (cf.
 * `useSubmitComment`) et `clear` remet la liste à zéro.
 *
 * Il n'y a pas d'historique séparé : un point se retire d'une croix, et le composeur reste le
 * seul endroit où on lit ce qui partira.
 */
export function usePoiDraft(): PoiDraftState {
  const [points, setPoints] = useState<PoiDraft[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);

  // Le plafond se lit sur la liste courante, hors de la fonction de mise à jour : celle-ci
  // peut être rejouée (mode strict), et un avertissement n'a pas à l'être.
  const count = points.length;
  const add = useCallback(
    (hotspot: Hotspot3D) => {
      if (count >= MAX_POI_POINTS) {
        toast.warning(t('poi.max', { count: MAX_POI_POINTS }));
        return;
      }
      const point: PoiDraft = { key: newKey(), ...hotspot, text: '', files: [] };
      setPoints((list) => [...list, point]);
      setActiveKey(point.key);
    },
    [count],
  );

  const move = useCallback((index: number, hotspot: Hotspot3D) => {
    setPoints((list) => list.map((p, i) => (i === index ? { ...p, ...hotspot } : p)));
  }, []);

  const remove = useCallback((key: string) => {
    setPoints((list) => list.filter((p) => p.key !== key));
    setActiveKey((active) => (active === key ? null : active));
  }, []);

  const patch = useCallback((key: string, apply: (point: PoiDraft) => PoiDraft) => {
    setPoints((list) => list.map((p) => (p.key === key ? apply(p) : p)));
  }, []);

  const setText = useCallback((key: string, text: string) => patch(key, (p) => ({ ...p, text })), [patch]);

  // Le plafond est celui des pièces jointes d'un commentaire : les images des points partent
  // dans la MÊME liste que celles du composeur (un seul téléversement, celui du lot 5).
  const addFiles = useCallback(
    (key: string, files: File[]) =>
      patch(key, (p) => ({ ...p, files: [...p.files, ...files].slice(0, MAX_COMMENT_ATTACHMENTS) })),
    [patch],
  );

  const removeFile = useCallback(
    (key: string, index: number) =>
      patch(key, (p) => ({ ...p, files: p.files.filter((_, i) => i !== index) })),
    [patch],
  );

  const clear = useCallback(() => {
    setPoints([]);
    setActiveKey(null);
  }, []);

  return useMemo(
    () => ({
      points,
      activeKey,
      setActiveKey,
      add,
      move,
      remove,
      setText,
      addFiles,
      removeFile,
      clear,
    }),
    [points, activeKey, add, move, remove, setText, addFiles, removeFile, clear],
  );
}
