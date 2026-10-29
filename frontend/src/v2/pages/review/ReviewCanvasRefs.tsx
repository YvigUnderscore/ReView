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
import { rescueRefBox } from './referenceBox';
import { useViewerBands } from './useViewerBands';
import type { Annotations } from './useAnnotations';
import type { MediaResp, ReviewReferenceItem } from './reviewTypes';
import { useT } from '../../i18n';

const MAX_REFS = 12;

/**
 * Reference images pinned to the canvas of the image review — **linked to a comment**.
 * Here are the **persisted** references: frozen, visible when their comment is selected
 * (historical references without a comment stay visible). Those being prepared live in
 * `StagedRefLayer`.
 *
 * Coordinates are fractions of the base image: a reference can be placed anywhere on the
 * canvas, inside or outside the media frame. Display leaves it exactly where it is as soon
 * as enough of it is visible, and only pulls back the one no viewer would show — inherited
 * positions (x = 1.05, from the time when pasting clamped nothing) would be invisible.
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
  // This layer follows the media: it serves as the ruler for the viewer bands, on which the
  // placement on paste and the pull-back of inherited positions depend — not the move, which is free.
  const layerRef = useRef<HTMLDivElement>(null);
  const bands = useViewerBands(layerRef);
  const { setRefBands } = ann;
  useEffect(() => {
    setRefBands(bands);
  }, [bands, setRefBands]);

  // Persisted: those of the selected comment + the historical ones (without a comment).
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
      <div ref={layerRef} className="pointer-events-none absolute inset-0 overflow-visible">
        {visible.map((r) => {
          const box = rescueRefBox(r, bands);
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
 * On-screen controls (outside the canvas): add button + global Ctrl+V paste — the image is
 * attached to the next comment. The document listener ignores pastes aimed at input fields
 * (the composer handles its own attachments).
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
  // Re-subscribed on every render (`ann` changes identity): negligible cost, fresh handler.
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
