import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ImagePlus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { useImagePaste } from '../../lib/useImagePaste';
import type { MediaResp } from './reviewTypes';

type Ref = NonNullable<MediaResp['reference']>;

/** Lit un fichier image en data URL (base64) pour l'upload. */
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

/**
 * Image de référence flottante (Phase 24) — persistée & partagée. Déplaçable/redimensionnable
 * par les gestionnaires (position en fractions du cadre) ; visible par tous. Se superpose au
 * viewer image, indépendante du zoom/pan de l'image principale.
 */
export default function ReferenceOverlay({
  mediaId,
  reference,
  canManage,
}: {
  mediaId: number;
  reference: Ref | null;
  canManage: boolean;
}) {
  const qc = useQueryClient();
  const onChange = () => qc.invalidateQueries({ queryKey: qk.media(mediaId) });
  const boxRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [local, setLocal] = useState<Ref | null>(reference);
  const drag = useRef<{ mode: 'move' | 'resize'; px: number; py: number; ref: Ref } | null>(null);

  // Resynchronise si la référence serveur change (ajustement au render).
  const [prev, setPrev] = useState(reference);
  if (reference !== prev) {
    setPrev(reference);
    setLocal(reference);
  }

  const upload = async (file: File) => {
    try {
      const dataUrl = await fileToDataUrl(file);
      await api.put(`/api/media/${mediaId}/reference`, { dataUrl });
      toast.success('Image de référence enregistrée');
      onChange();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Envoi impossible');
    }
  };
  const onPasteImage = useImagePaste((files) => files[0] && void upload(files[0]));

  const remove = async () => {
    try {
      await api.del(`/api/media/${mediaId}/reference`);
      onChange();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Suppression impossible');
    }
  };

  const savePosition = (r: Ref) => {
    void api.patch(`/api/media/${mediaId}/reference`, { x: r.x, y: r.y, width: r.width }).catch(() => {
      toast.error('Position non enregistrée');
    });
  };

  const onPointerDown = (mode: 'move' | 'resize') => (e: React.PointerEvent) => {
    if (!canManage || !local) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { mode, px: e.clientX, py: e.clientY, ref: local };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const box = boxRef.current;
    if (!drag.current || !box) return;
    const rect = box.getBoundingClientRect();
    const dx = (e.clientX - drag.current.px) / rect.width;
    const dy = (e.clientY - drag.current.py) / rect.height;
    const base = drag.current.ref;
    if (drag.current.mode === 'move') {
      setLocal({ ...base, x: clamp(base.x + dx, 0, 1), y: clamp(base.y + dy, 0, 1) });
    } else {
      setLocal({ ...base, width: clamp(base.width + dx, 0.05, 1) });
    }
  };
  const onPointerUp = () => {
    if (drag.current && local) savePosition(local);
    drag.current = null;
  };

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void upload(file);
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <div
      ref={boxRef}
      className="pointer-events-none absolute inset-0"
      onPaste={canManage ? onPasteImage : undefined}
    >
      {local && (
        <div
          className="pointer-events-auto absolute overflow-hidden rounded border-2 border-primary/60 shadow-lg"
          style={{ left: `${local.x * 100}%`, top: `${local.y * 100}%`, width: `${local.width * 100}%` }}
          onPointerDown={onPointerDown('move')}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          <img src={local.url} alt="Référence" className="block w-full select-none" draggable={false} />
          {canManage && (
            <>
              <button
                type="button"
                onClick={remove}
                title="Retirer la référence"
                className="absolute right-1 top-1 rounded bg-black/60 p-1 text-white hover:bg-black/80"
              >
                <Trash2 size={12} />
              </button>
              <div
                onPointerDown={onPointerDown('resize')}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                title="Redimensionner"
                className="absolute bottom-0 right-0 h-4 w-4 cursor-se-resize bg-primary/70"
              />
            </>
          )}
        </div>
      )}

      {canManage && !local && (
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="pointer-events-auto absolute left-2 top-2 flex items-center gap-1 rounded-md border border-border bg-card/90 px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ImagePlus size={14} /> Image de référence
        </button>
      )}
      {canManage && <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onFile} />}
    </div>
  );
}

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);
