// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ImagePlus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { fileToImageDataUrl, imageFilesFromClipboard } from '../../lib/useImagePaste';
import type { Annotations } from './useAnnotations';
import type { MediaResp, ReviewReferenceItem } from './reviewTypes';

const MAX_REFS = 12;

/**
 * Images de référence épinglées au canvas de la review image — **liées à un commentaire**.
 * Deux familles :
 * - références **persistées** : figées (plus déplaçables), affichées uniquement quand leur
 *   commentaire est sélectionné (les références historiques sans commentaire restent visibles) ;
 * - références **en préparation** (composer) : collées/ajoutées avant l'envoi du commentaire,
 *   déplaçables/redimensionnables jusqu'à l'envoi, puis figées côté serveur.
 * Rendues DANS le plan transformé du viewer (elles suivent le zoom/pan) ; coordonnées en
 * fractions de l'image de base.
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
  const qc = useQueryClient();
  const rootRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    key: string;
    mode: 'move' | 'resize';
    px: number;
    py: number;
    start: { x: number; y: number; width: number };
  } | null>(null);

  // Persistées : celles du commentaire sélectionné + les historiques (sans commentaire).
  const visible = references.filter((r) => r.commentId == null || r.commentId === selectedCommentId);

  const removePersisted = async (id: number) => {
    try {
      await api.del(`/api/media/${mediaId}/references/${id}`);
      qc.setQueryData<MediaResp>(qk.media(mediaId), (old) =>
        old ? { ...old, references: (old.references ?? []).filter((r) => r.id !== id) } : old,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Suppression impossible');
    }
  };

  // Drag des références en préparation uniquement.
  const onPointerDown = (key: string, mode: 'move' | 'resize') => (e: React.PointerEvent) => {
    const r = ann.stagedRefs.find((s) => s.key === key);
    if (!r) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { key, mode, px: e.clientX, py: e.clientY, start: { x: r.x, y: r.y, width: r.width } };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const root = rootRef.current;
    const d = drag.current;
    if (!d || !root) return;
    const rect = root.getBoundingClientRect();
    const dx = (e.clientX - d.px) / rect.width;
    const dy = (e.clientY - d.py) / rect.height;
    ann.updateStagedRef(
      d.key,
      d.mode === 'move'
        ? { x: d.start.x + dx, y: d.start.y + dy }
        : { width: Math.max(d.start.width + dx, 0.02) },
    );
  };
  const onPointerUp = () => (drag.current = null);

  return (
    <div ref={rootRef} className="pointer-events-none absolute inset-0 overflow-visible">
      {visible.map((r) => (
        <div
          key={r.id}
          className="absolute overflow-hidden rounded border border-white/20 shadow-lg"
          style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.width * 100}%` }}
        >
          <img src={r.url} alt="Référence" className="block w-full select-none" draggable={false} />
          {canManage && (
            <button
              type="button"
              onClick={() => void removePersisted(r.id)}
              title="Retirer la référence"
              className="pointer-events-auto absolute right-1 top-1 rounded bg-black/60 p-1 text-white hover:bg-black/80"
            >
              <Trash2 size={12} />
            </button>
          )}
        </div>
      ))}

      {/* Références en préparation : liseré primaire, déplaçables jusqu'à l'envoi. */}
      {ann.stagedRefs.map((r) => (
        <div
          key={r.key}
          className="pointer-events-auto absolute cursor-move overflow-hidden rounded border-2 border-primary/70 shadow-lg"
          style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.width * 100}%` }}
          onPointerDown={onPointerDown(r.key, 'move')}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          <img
            src={r.dataUrl}
            alt="Référence (brouillon)"
            className="block w-full select-none"
            draggable={false}
          />
          <button
            type="button"
            onClick={() => ann.removeStagedRef(r.key)}
            title="Retirer la référence"
            className="absolute right-1 top-1 rounded bg-black/60 p-1 text-white hover:bg-black/80"
          >
            <Trash2 size={12} />
          </button>
          <div
            onPointerDown={onPointerDown(r.key, 'resize')}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            title="Redimensionner"
            className="absolute bottom-0 right-0 h-4 w-4 cursor-se-resize bg-primary/70"
          />
        </div>
      ))}
    </div>
  );
}

/**
 * Contrôles écran (hors canvas) : bouton d'ajout + collage CTRL+V global — l'image est
 * **jointe au prochain commentaire** (staged). Le listener document ignore les collages
 * destinés aux champs de saisie (le composer gère ses propres pièces jointes).
 */
export function ReviewCanvasRefsControls({ ann, annotating }: { ann: Annotations; annotating: boolean }) {
  const fileRef = useRef<HTMLInputElement>(null);

  const stage = async (file: File) => {
    if (ann.stagedRefs.length >= MAX_REFS) {
      toast.warning(`${MAX_REFS} images de référence max`);
      return;
    }
    try {
      ann.addStagedRef(await fileToImageDataUrl(file));
      toast.success('Image de référence jointe au prochain commentaire');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Lecture du fichier impossible');
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
        title="Joindre une image de référence au prochain commentaire (ou coller avec Ctrl+V)"
        className={`pointer-events-auto absolute left-2 top-2 z-10 flex items-center gap-1 rounded-md border px-2 py-1 text-xs ${
          annotating || ann.stagedRefs.length > 0
            ? 'border-primary/50 bg-card/90 text-primary'
            : 'border-border bg-card/90 text-muted-foreground hover:text-foreground'
        }`}
      >
        <ImagePlus size={14} /> Référence (Ctrl+V)
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
