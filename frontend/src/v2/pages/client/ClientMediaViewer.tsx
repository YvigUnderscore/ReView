import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Clock, Send } from 'lucide-react';
import { toast } from 'sonner';
import { clientApi } from './clientApi';
import WatermarkOverlay from '../../components/WatermarkOverlay';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Textarea } from '../../components/ui/textarea';
import type { ClientComment, ClientMedia } from '../../types/api';

const fmtTime = (sec: number) => {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
};

/** Lecteur épuré de la page client (35.D) : vidéo/image + commentaires visibles client. */
export default function ClientMediaViewer({
  token,
  media,
  canComment,
  watermarkText,
  watermarkOpacity,
  onBack,
}: {
  token: string;
  media: ClientMedia;
  canComment: boolean;
  watermarkText: string | null;
  watermarkOpacity: number;
  onBack: () => void;
}) {
  const qc = useQueryClient();
  const videoRef = useRef<HTMLVideoElement>(null);
  const playable = media.kind === 'VIDEO' || media.kind === 'IMAGE';

  const urlQ = useQuery({
    queryKey: ['client-share', token, 'media', media.id, 'url'],
    queryFn: () => clientApi.get<{ url: string; slateSec?: number }>(token, `/media/${media.id}/url`),
    enabled: playable,
    staleTime: 5 * 60 * 1000,
  });
  // Slate en tête du dérivé client (35.A) : les timestamps de commentaires restent exprimés
  // dans le référentiel du média (sans slate) — on décale à l'envoi et au seek.
  const slateSec = urlQ.data?.slateSec ?? 0;
  const commentsQ = useQuery({
    queryKey: ['client-share', token, 'media', media.id, 'comments'],
    queryFn: () => clientApi.get<{ comments: ClientComment[] }>(token, `/media/${media.id}/comments`),
  });
  const comments = commentsQ.data?.comments ?? [];

  const [guestName, setGuestName] = useState(() => localStorage.getItem('client-guest-name') ?? '');
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!guestName.trim() || !content.trim()) return;
    setBusy(true);
    try {
      localStorage.setItem('client-guest-name', guestName.trim());
      const timestamp =
        media.kind === 'VIDEO' && videoRef.current
          ? Math.max(0, videoRef.current.currentTime - slateSec)
          : undefined;
      await clientApi.post(token, `/media/${media.id}/comments`, {
        guestName: guestName.trim(),
        content: content.trim(),
        ...(timestamp !== undefined ? { timestamp } : {}),
      });
      setContent('');
      toast.success('Commentaire envoyé');
      qc.invalidateQueries({ queryKey: ['client-share', token, 'media', media.id, 'comments'] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setBusy(false);
    }
  };

  const seek = (sec: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = sec + slateSec;
      videoRef.current.play().catch(() => undefined);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
      <div className="flex min-w-0 flex-1 flex-col">
        <button
          onClick={onBack}
          className="mb-3 flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft size={15} /> Tous les médias
        </button>
        <div className="relative flex flex-1 items-center justify-center overflow-hidden rounded-lg border border-border bg-black/60">
          {media.kind === 'VIDEO' && urlQ.data && (
            <video
              ref={videoRef}
              src={urlQ.data.url}
              // Sans mode CORS, l'ORB de Chrome bloque le mp4 presigné cross-origin (MinIO)
              // en sous-ressource no-cors — découvert en vérification navigateur.
              crossOrigin="anonymous"
              controls
              controlsList="nodownload"
              className="max-h-[70vh] w-full"
            />
          )}
          {media.kind === 'IMAGE' && urlQ.data && (
            <img src={urlQ.data.url} alt={media.originalName} className="max-h-[70vh] object-contain" />
          )}
          {playable && !urlQ.data && (
            <p className="p-10 text-sm text-muted-foreground">
              {urlQ.error ? urlQ.error.message : 'Chargement…'}
            </p>
          )}
          {!playable && (
            <p className="p-10 text-center text-sm text-muted-foreground">
              Aperçu non disponible pour ce type de média ({media.kind}).
              <br />
              Contactez le studio pour une session de review.
            </p>
          )}
          {watermarkText && <WatermarkOverlay text={watermarkText} opacity={watermarkOpacity} />}
        </div>
        <p className="mt-2 truncate text-sm text-muted-foreground">{media.originalName}</p>
      </div>

      <aside className="flex w-full flex-col rounded-lg border border-border bg-card lg:w-80">
        <h2 className="border-b border-border px-4 py-3 text-sm font-semibold">Commentaires</h2>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          {comments.length === 0 && (
            <p className="text-sm text-muted-foreground">Aucun commentaire pour le moment.</p>
          )}
          {comments.map((c) => (
            <div key={c.id} className="rounded-md bg-secondary/40 p-2.5 text-sm">
              <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">
                  {c.author?.name ?? c.guestName ?? 'Anonyme'}
                </span>
                {c.timestamp != null && media.kind === 'VIDEO' && (
                  <button
                    onClick={() => seek(c.timestamp!)}
                    className="flex items-center gap-1 rounded bg-primary/15 px-1.5 py-0.5 text-primary hover:bg-primary/25"
                  >
                    <Clock size={11} /> {fmtTime(c.timestamp)}
                  </button>
                )}
              </div>
              {/* Contenu déjà assaini côté serveur (sanitizeHtml) — affiché en texte brut. */}
              <p className="whitespace-pre-wrap break-words">{c.content.replace(/<[^>]+>/g, '')}</p>
            </div>
          ))}
        </div>
        {canComment && (
          <form onSubmit={submit} className="space-y-2 border-t border-border p-3">
            <Input
              value={guestName}
              onChange={(e) => setGuestName(e.target.value)}
              placeholder="Votre nom"
              maxLength={80}
              required
            />
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={media.kind === 'VIDEO' ? 'Commenter à l’image courante…' : 'Votre commentaire…'}
              rows={3}
              maxLength={10000}
              required
            />
            <Button type="submit" size="sm" disabled={busy} className="w-full">
              <Send size={13} className="mr-1" /> Envoyer
            </Button>
          </form>
        )}
      </aside>
    </div>
  );
}
