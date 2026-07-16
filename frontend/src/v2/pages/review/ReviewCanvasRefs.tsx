import { useEffect, useRef, useState } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { ImagePlus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { imageFilesFromClipboard } from '../../lib/useImagePaste';
import type { MediaResp, ReviewReferenceItem } from './reviewTypes';

const MAX_REFS = 12;

/** Lit un fichier image en data URL (base64) pour l'upload. */
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

/** Patch ciblé du cache media : évite un refetch (les URLs présignées rechargeraient le viewer). */
function patchRefs(
  qc: QueryClient,
  mediaId: number,
  fn: (refs: ReviewReferenceItem[]) => ReviewReferenceItem[],
) {
  qc.setQueryData<MediaResp>(qk.media(mediaId), (old) =>
    old ? { ...old, references: fn(old.references ?? []) } : old,
  );
}

async function addReference(qc: QueryClient, mediaId: number, file: File, count: number) {
  if (count >= MAX_REFS) {
    toast.warning(`${MAX_REFS} images de référence max`);
    return;
  }
  try {
    const dataUrl = await fileToDataUrl(file);
    const { reference } = await api.post<{ reference: ReviewReferenceItem }>(
      `/api/media/${mediaId}/references`,
      { dataUrl },
    );
    patchRefs(qc, mediaId, (refs) => [...refs, reference]);
    toast.success('Image de référence ajoutée');
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Envoi impossible');
  }
}

/**
 * Images de référence épinglées au canvas de la review image (Phase 24, multi-items) —
 * persistées & partagées. Rendues DANS le plan transformé du viewer (elles suivent le
 * zoom/pan, « fixées au canvas ») ; coordonnées en fractions de l'image de base.
 */
export default function ReviewCanvasRefs({
  mediaId,
  references,
  canManage,
}: {
  mediaId: number;
  references: ReviewReferenceItem[];
  canManage: boolean;
}) {
  const qc = useQueryClient();
  const rootRef = useRef<HTMLDivElement>(null);
  const [local, setLocal] = useState(references);
  const drag = useRef<{
    id: number;
    mode: 'move' | 'resize';
    px: number;
    py: number;
    ref: ReviewReferenceItem;
  } | null>(null);

  // Resynchronise si la liste serveur change (ajustement au render).
  const [prev, setPrev] = useState(references);
  if (references !== prev) {
    setPrev(references);
    setLocal(references);
  }

  const savePosition = (r: ReviewReferenceItem) => {
    void api
      .patch(`/api/media/${mediaId}/references/${r.id}`, { x: r.x, y: r.y, width: r.width })
      .then(() => patchRefs(qc, mediaId, (refs) => refs.map((o) => (o.id === r.id ? { ...o, ...r } : o))))
      .catch(() => toast.error('Position non enregistrée'));
  };

  const remove = async (id: number) => {
    try {
      await api.del(`/api/media/${mediaId}/references/${id}`);
      patchRefs(qc, mediaId, (refs) => refs.filter((r) => r.id !== id));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Suppression impossible');
    }
  };

  const onPointerDown = (r: ReviewReferenceItem, mode: 'move' | 'resize') => (e: React.PointerEvent) => {
    if (!canManage) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { id: r.id, mode, px: e.clientX, py: e.clientY, ref: r };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const root = rootRef.current;
    const d = drag.current;
    if (!d || !root) return;
    // Le plan est mis à l'échelle par le viewer : rect = dimensions écran de l'image de base.
    const rect = root.getBoundingClientRect();
    const dx = (e.clientX - d.px) / rect.width;
    const dy = (e.clientY - d.py) / rect.height;
    setLocal((refs) =>
      refs.map((r) =>
        r.id === d.id
          ? d.mode === 'move'
            ? { ...r, x: d.ref.x + dx, y: d.ref.y + dy }
            : { ...r, width: Math.max(d.ref.width + dx, 0.02) }
          : r,
      ),
    );
  };
  const onPointerUp = () => {
    const d = drag.current;
    if (d) {
      const r = local.find((o) => o.id === d.id);
      if (r) savePosition(r);
    }
    drag.current = null;
  };

  return (
    <div ref={rootRef} className="pointer-events-none absolute inset-0 overflow-visible">
      {local.map((r) => (
        <div
          key={r.id}
          className={`absolute overflow-hidden rounded border border-white/20 shadow-lg ${
            canManage ? 'pointer-events-auto cursor-move' : ''
          }`}
          style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.width * 100}%` }}
          onPointerDown={onPointerDown(r, 'move')}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          <img src={r.url} alt="Référence" className="block w-full select-none" draggable={false} />
          {canManage && (
            <>
              <button
                type="button"
                onClick={() => void remove(r.id)}
                title="Retirer la référence"
                className="absolute right-1 top-1 rounded bg-black/60 p-1 text-white hover:bg-black/80"
              >
                <Trash2 size={12} />
              </button>
              <div
                onPointerDown={onPointerDown(r, 'resize')}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                title="Redimensionner"
                className="absolute bottom-0 right-0 h-4 w-4 cursor-se-resize bg-primary/70"
              />
            </>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * Contrôles écran (hors canvas) : bouton d'ajout + collage CTRL+V global. Le listener
 * document ignore les collages destinés aux champs de saisie (composer de commentaires).
 */
export function ReviewCanvasRefsControls({
  mediaId,
  count,
  canManage,
}: {
  mediaId: number;
  count: number;
  canManage: boolean;
}) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!canManage) return;
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const files = imageFilesFromClipboard(e.clipboardData);
      if (files[0]) {
        e.preventDefault();
        void addReference(qc, mediaId, files[0], count);
      }
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [canManage, mediaId, count, qc]);

  if (!canManage) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        title="Ajouter une image de référence (ou coller avec Ctrl+V)"
        className="pointer-events-auto absolute left-2 top-2 z-10 flex items-center gap-1 rounded-md border border-border bg-card/90 px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ImagePlus size={14} /> Référence (Ctrl+V)
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void addReference(qc, mediaId, file, count);
          if (fileRef.current) fileRef.current.value = '';
        }}
      />
    </>
  );
}
