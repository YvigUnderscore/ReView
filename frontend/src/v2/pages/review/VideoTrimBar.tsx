import { Scissors, Trash2 } from 'lucide-react';
import { useState, type RefObject } from 'react';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { tcFromFrame, type MediaResp, type SplatEditsPatch } from './reviewTypes';

/**
 * Trim vidéo non-destructif (10.G-V10), gestionnaires : bornes IN/OUT posées à la frame
 * courante, appliquées via PATCH `/api/media/:id/trim` — le worker FFmpeg produit un **proxy
 * trimé** (l'original n'est jamais modifié), servi à tous au prochain chargement. Sur un média
 * publié, le backend pose le marqueur « modifié après publication ».
 */
export default function VideoTrimBar({
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
  const [inFrame, setInFrame] = useState<number | null>(data.trim?.inFrame ?? null);
  const [outFrame, setOutFrame] = useState<number | null>(data.trim?.outFrame ?? null);
  const [busy, setBusy] = useState(false);

  const currentFrame = () => Math.round((videoRef.current?.currentTime ?? 0) * fps);
  const dirty = inFrame !== (data.trim?.inFrame ?? null) || outFrame !== (data.trim?.outFrame ?? null);
  const valid = inFrame != null && outFrame != null && outFrame > inFrame;

  const apply = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      const patch = await api.patch<SplatEditsPatch>(`/api/media/${data.media.id}/trim`, {
        trim: { inFrame, outFrame },
      });
      onSaved(patch);
      toast.success('Trim enregistré — proxy trimé en cours de génération (servi au prochain chargement)');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur à l'enregistrement du trim");
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    setBusy(true);
    try {
      const patch = await api.patch<SplatEditsPatch>(`/api/media/${data.media.id}/trim`, { trim: null });
      onSaved(patch);
      setInFrame(null);
      setOutFrame(null);
      toast.success('Trim effacé — retour à la vidéo complète');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur à l'effacement du trim");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 rounded-md border border-border bg-card/60 px-3 py-1.5 text-xs">
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <Scissors size={13} /> Trim
      </span>
      <button
        onClick={() => setInFrame(currentFrame())}
        title="Définir le point d'entrée à la frame courante"
        className="rounded-md border border-border px-2 py-1 font-medium text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
      >
        IN
      </button>
      <span className="font-mono text-foreground">{inFrame != null ? tcFromFrame(inFrame, fps) : '—'}</span>
      <button
        onClick={() => setOutFrame(currentFrame())}
        title="Définir le point de sortie à la frame courante"
        className="rounded-md border border-border px-2 py-1 font-medium text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
      >
        OUT
      </button>
      <span className="font-mono text-foreground">{outFrame != null ? tcFromFrame(outFrame, fps) : '—'}</span>
      <button
        onClick={() => void apply()}
        disabled={busy || !valid || !dirty}
        className="rounded-md bg-primary px-2.5 py-1 font-medium text-primary-foreground disabled:opacity-50"
      >
        Appliquer
      </button>
      {data.trim && (
        <>
          <button
            onClick={() => void clear()}
            disabled={busy}
            title="Effacer le trim (retour à la vidéo complète)"
            className="flex items-center justify-center rounded-md border border-border p-1 text-muted-foreground hover:bg-secondary/60 hover:text-foreground disabled:opacity-50"
          >
            <Trash2 size={12} />
          </button>
          <span className="text-muted-foreground">
            {data.trimProxyReady
              ? 'Proxy trimé actif (rechargez pour le lire)'
              : 'Proxy trimé en cours de génération…'}
          </span>
        </>
      )}
    </div>
  );
}
