// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ImagePlus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { fileToImageDataUrl, imageFilesFromClipboard } from '../../lib/useImagePaste';
import StagedRefLayer from './StagedRefLayer';
import { clampRefBox } from './referenceBox';
import type { Annotations } from './useAnnotations';
import type { MediaResp, ReviewReferenceItem } from './reviewTypes';
import { useT } from '../../i18n';

const MAX_REFS = 12;

/**
 * Images de référence épinglées au canvas de la review image — **liées à un commentaire**.
 * Ici les références **persistées** : figées, visibles quand leur commentaire est sélectionné
 * (les références historiques sans commentaire restent visibles). Celles en préparation vivent
 * dans `StagedRefLayer`. Coordonnées en fractions de l'image de base, recadrées à l'affichage :
 * l'ancien collage en posait hors cadre, et elles seraient restées invisibles.
 */
export default function ReviewCanvasRefs({
  mediaId,
  references,
  selectedCommentId,
  canManage,
  ann,
}: {
  mediaId: number;
  references: ReviewReferenceItem[];
  selectedCommentId: number | null;
  canManage: boolean;
  ann: Annotations;
}) {
  const t = useT();
  const qc = useQueryClient();

  // Persistées : celles du commentaire sélectionné + les historiques (sans commentaire).
  const visible = references.filter((r) => r.commentId == null || r.commentId === selectedCommentId);

  const removePersisted = async (id: number) => {
    try {
      await api.del(`/api/media/${mediaId}/references/${id}`);
      qc.setQueryData<MediaResp>(qk.media(mediaId), (old) =>
        old ? { ...old, references: (old.references ?? []).filter((r) => r.id !== id) } : old,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('common.error.delete'));
    }
  };

  return (
    <>
      <div className="pointer-events-none absolute inset-0 overflow-visible">
        {visible.map((r) => {
          const box = clampRefBox(r);
          return (
            <div
              key={r.id}
              className="absolute overflow-hidden rounded border border-white/20 shadow-lg"
              style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.width * 100}%` }}
            >
              <img src={r.url} alt={t('ref.title')} className="block w-full select-none" draggable={false} />
              {canManage && (
                <button
                  type="button"
                  onClick={() => void removePersisted(r.id)}
                  title={t('review.ref.remove')}
                  className="pointer-events-auto absolute right-1 top-1 rounded bg-black/60 p-1 text-white hover:bg-black/80"
                >
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          );
        })}
      </div>
      <StagedRefLayer ann={ann} />
    </>
  );
}

/**
 * Contrôles écran (hors canvas) : bouton d'ajout + collage Ctrl+V global — l'image est jointe
 * au prochain commentaire. Le listener document ignore les collages destinés aux champs de
 * saisie (le composer gère ses propres pièces jointes).
 */
export function ReviewCanvasRefsControls({ ann, annotating }: { ann: Annotations; annotating: boolean }) {
  const t = useT();
  const fileRef = useRef<HTMLInputElement>(null);

  const stage = async (file: File) => {
    if (ann.stagedRefs.length >= MAX_REFS) {
      toast.warning(t('ref.maxImages', { count: MAX_REFS }));
      return;
    }
    try {
      ann.addStagedRef(await fileToImageDataUrl(file));
      toast.success(t('review.ref.attached'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('file.readFailed'));
    }
  };
  // Ré-abonné à chaque render (`ann` change d'identité) : coût négligeable, handler frais.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const files = imageFilesFromClipboard(e.clipboardData);
      if (files[0]) {
        e.preventDefault();
        void stage(files[0]);
      }
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  });

  return (
    <>
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        title={t('review.ref.attach')}
        className={`pointer-events-auto absolute left-2 top-2 z-10 flex items-center gap-1 rounded-md border px-2 py-1 text-xs ${
          annotating || ann.stagedRefs.length > 0
            ? 'border-primary/50 bg-card/90 text-primary'
            : 'border-border bg-card/90 text-muted-foreground hover:text-foreground'
        }`}
      >
        <ImagePlus size={14} /> {t('ref.addPaste')}
        {ann.stagedRefs.length > 0 && <span className="font-semibold">· {ann.stagedRefs.length}</span>}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void stage(file);
          if (fileRef.current) fileRef.current.value = '';
        }}
      />
    </>
  );
}
