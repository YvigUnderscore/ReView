import { useRef, useState, type FormEvent, type KeyboardEvent, type RefObject } from 'react';
import { ImagePlus, PencilLine, X } from 'lucide-react';
import { ATTACHMENT_ACCEPT } from '../../../lib/commentAttachments';
import ReviewComments from '../../components/ReviewComments';
import type { ReviewComment } from '../../types/api';
import { SkeletonRows } from '../../components/ui/skeleton';
import { Textarea } from '../../components/ui/textarea';
import { ResizablePanel } from '../../components/ui/resizable';
import { useImagePaste } from '../../lib/useImagePaste';

/**
 * Panneau latéral des commentaires : liste (avec skeleton de chargement) +
 * composer (texte, images jointes, indicateurs d'annotation/hotspot/caméra).
 * L'envoi est délégué à `onSubmit` (l'orchestrateur joint timestamp, caméra
 * et annotations) ; le panneau ne vide sa saisie que si l'envoi a réussi.
 */
export default function CommentsPanel({
  comments,
  mediaObjectId,
  currentUserId,
  currentUserRole,
  reload,
  fps,
  startFrame,
  selectedId,
  onSelect,
  composerRef,
  hints,
  onSubmit,
  annotating,
  onToggleAnnotate,
}: {
  comments: ReviewComment[] | null;
  mediaObjectId: number;
  currentUserId: number;
  currentUserRole?: string;
  reload: () => void;
  fps: number;
  startFrame: number;
  selectedId: number | null;
  onSelect: (c: ReviewComment) => void;
  composerRef: RefObject<HTMLTextAreaElement | null>;
  hints: { annotation: boolean; hotspot: boolean; camera: boolean };
  onSubmit: (content: string, files: File[]) => Promise<boolean>;
  /** Mode annotation actif (bouton « Annoter » sous le champ, Phase 24). */
  annotating?: boolean;
  onToggleAnnotate?: () => void;
}) {
  const [content, setContent] = useState('');
  const [attachFiles, setAttachFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const onPasteImage = useImagePaste((files) => setAttachFiles((fs) => [...fs, ...files]));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!content.trim() && attachFiles.length === 0) return;
    setSending(true);
    try {
      if (await onSubmit(content, attachFiles)) {
        setContent('');
        setAttachFiles([]);
      }
    } finally {
      setSending(false);
    }
  };

  // Entrée = saut de ligne (défaut textarea) ; Ctrl/Cmd+Entrée = envoi.
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void submit(e as unknown as FormEvent);
    }
  };

  return (
    <ResizablePanel
      storageKey="review-comments"
      side="left"
      defaultSize={380}
      min={300}
      max={680}
      className="flex flex-col rounded-lg border border-border bg-card"
    >
      <div className="shrink-0 border-b border-border px-4 py-2.5 text-sm font-semibold">
        Commentaires {comments && <span className="text-muted-foreground">· {comments.length}</span>}
      </div>
      <div className="custom-scrollbar min-h-0 flex-1 overflow-auto p-4">
        {comments === null ? (
          <SkeletonRows count={4} />
        ) : (
          <ReviewComments
            comments={comments}
            mediaObjectId={mediaObjectId}
            currentUserId={currentUserId}
            currentUserRole={currentUserRole}
            reload={reload}
            fps={fps}
            startFrame={startFrame}
            selectedId={selectedId}
            onSelect={onSelect}
          />
        )}
      </div>
      <form onSubmit={submit} className="shrink-0 border-t border-border p-3">
        {attachFiles.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1">
            {attachFiles.map((f, i) => (
              <span
                key={i}
                className="flex items-center gap-1 rounded bg-secondary px-1.5 py-0.5 text-[10px]"
              >
                {f.name}
                <button type="button" onClick={() => setAttachFiles((fs) => fs.filter((_, j) => j !== i))}>
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
        )}
        {hints.annotation && <p className="mb-1.5 text-[11px] text-primary">✏️ Annotation jointe</p>}
        {hints.hotspot && (
          <p className="mb-1.5 text-[11px] text-primary">📍 Hotspot joint (centre du viewer)</p>
        )}
        {hints.camera && (
          <p className="mb-1.5 text-[11px] text-primary">📷 La vue caméra actuelle sera enregistrée</p>
        )}
        <Textarea
          ref={composerRef}
          autoGrow
          minRows={2}
          maxRows={10}
          placeholder="Ajouter un commentaire… (Ctrl+Entrée pour envoyer)"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPasteImage}
        />
        <div className="mt-2 flex items-center justify-between">
          <input
            ref={fileRef}
            type="file"
            accept={ATTACHMENT_ACCEPT}
            multiple
            className="hidden"
            onChange={(e) => {
              setAttachFiles((fs) => [...fs, ...Array.from(e.target.files ?? [])]);
              if (fileRef.current) fileRef.current.value = '';
            }}
          />
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              title="Joindre une image"
              className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              <ImagePlus size={16} />
            </button>
            {onToggleAnnotate && (
              <button
                type="button"
                onClick={onToggleAnnotate}
                title="Annoter le média"
                className={`flex items-center gap-1 rounded-md px-2 py-1.5 text-xs ${
                  annotating
                    ? 'bg-primary/20 text-primary'
                    : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                }`}
              >
                <PencilLine size={15} /> Annoter
              </button>
            )}
          </div>
          <button
            type="submit"
            disabled={sending}
            className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {sending ? 'Envoi…' : 'Envoyer'}
          </button>
        </div>
      </form>
    </ResizablePanel>
  );
}
