// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useState, type RefObject } from 'react';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { tcFromFrame, type MediaResp, type SplatEditsPatch } from './reviewTypes';
import { useT } from '../../i18n';

/**
 * Trim vidéo non-destructif, gestionnaires : bornes IN/OUT posées à la frame courante,
 * appliquées via PATCH `/api/media/:id/trim` — le worker FFmpeg produit un **proxy trimé**
 * (l'original n'est jamais modifié), servi à tous au prochain chargement.
 *
 * Extrait de `VideoTrimBar` avec la refonte du chrome : la barre a disparu, les bornes se
 * posent depuis les outils « Point d'entrée » / « Point de sortie » du rail.
 */
export function useVideoTrim({
  data,
  fps,
  videoRef,
  onSaved,
}: {
  data: MediaResp;
  fps: number;
  videoRef: RefObject<HTMLVideoElement | null>;
  onSaved: (patch: SplatEditsPatch) => void;
}) {
  const t = useT();
  const [inFrame, setInFrame] = useState<number | null>(data.trim?.inFrame ?? null);
  const [outFrame, setOutFrame] = useState<number | null>(data.trim?.outFrame ?? null);
  const [busy, setBusy] = useState(false);

  const currentFrame = () => Math.round((videoRef.current?.currentTime ?? 0) * fps);
  const dirty = inFrame !== (data.trim?.inFrame ?? null) || outFrame !== (data.trim?.outFrame ?? null);
  const valid = inFrame != null && outFrame != null && outFrame > inFrame;

  const apply = useCallback(async () => {
    if (!valid) {
      toast.error(t('trim.outAfterIn'));
      return;
    }
    setBusy(true);
    try {
      const patch = await api.patch<SplatEditsPatch>(`/api/media/${data.media.id}/trim`, {
        trim: { inFrame, outFrame },
      });
      onSaved(patch);
      toast.success(t('trim.saved'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('trim.saveFailed'));
    } finally {
      setBusy(false);
    }
  }, [valid, data.media.id, inFrame, outFrame, onSaved, t]);

  const clear = useCallback(async () => {
    setBusy(true);
    try {
      const patch = await api.patch<SplatEditsPatch>(`/api/media/${data.media.id}/trim`, {
        trim: null,
      });
      onSaved(patch);
      setInFrame(null);
      setOutFrame(null);
      toast.success(t('trim.cleared'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('trim.clearFailed'));
    } finally {
      setBusy(false);
    }
  }, [data.media.id, onSaved, t]);

  /** Résumé affiché dans la barre d'options : bornes posées et longueur conservée. */
  const label =
    inFrame != null && outFrame != null
      ? t('trim.range', {
          in: tcFromFrame(inFrame, fps),
          out: tcFromFrame(outFrame, fps),
          frames: outFrame - inFrame,
        })
      : inFrame != null
        ? t('trim.inOnly', { in: tcFromFrame(inFrame, fps) })
        : outFrame != null
          ? t('trim.outOnly', { out: tcFromFrame(outFrame, fps) })
          : t('trim.none');

  return {
    inFrame,
    outFrame,
    dirty,
    busy,
    label,
    onIn: () => setInFrame(currentFrame()),
    onOut: () => setOutFrame(currentFrame()),
    onApply: () => void apply(),
    onClear: () => void clear(),
  };
}
