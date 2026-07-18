import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { ImagePlus, PencilLine, X } from 'lucide-react';
import { toast } from 'sonner';
import { ATTACHMENT_ACCEPT, MAX_COMMENT_ATTACHMENTS } from '../../../lib/commentAttachments';
import ReviewComments from '../../components/ReviewComments';
import type { ReviewComment } from '../../types/api';
import { SkeletonRows } from '../../components/ui/skeleton';
import { Textarea } from '../../components/ui/textarea';
import { ResizablePanel } from '../../components/ui/resizable';
import { useImagePaste } from '../../lib/useImagePaste';
import { useMentions } from '../../components/comments/useMentions';
import MentionMenu from '../../components/comments/MentionMenu';
import VoiceRecorderButton from '../../components/comments/VoiceRecorderButton';
import { clearDraft, loadDraft, saveDraft } from './commentDraft';

/** Filtre de résolution du fil (32.A). */
type ResolutionFilter = 'all' | 'open' | 'resolved';
const FILTERS: { value: ResolutionFilter; label: string }[] = [
  { value: 'all', label: 'Tous' },
  { value: 'open', label: 'Ouverts' },
  { value: 'resolved', label: 'Résolus' },
];

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
  annotationTools,
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
  hints: { annotation: boolean; hotspot: boolean; camera: boolean; references?: number };
  onSubmit: (content: string, files: File[]) => Promise<boolean>;
  /** Mode annotation actif (bouton « Annoter » sous le champ, Phase 24). */
  annotating?: boolean;
  onToggleAnnotate?: () => void;
  /** Barre d'outils d'annotation, affichée sous le composer quand le mode est actif. */
  annotationTools?: ReactNode;
}) {
  // Brouillon local (32.C) : le texte en cours survit à un rechargement/navigation.
  const [content, setContent] = useState(() => loadDraft(mediaObjectId)?.content ?? '');
  const [filter, setFilter] = useState<ResolutionFilter>('all');
  const [attachFiles, setAttachFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    saveDraft(mediaObjectId, { content });
  }, [content, mediaObjectId]);
  const addFiles = (files: File[]) => {
    if (attachFiles.length + files.length > MAX_COMMENT_ATTACHMENTS)
      toast.warning(`${MAX_COMMENT_ATTACHMENTS} pièces jointes max par commentaire`);
    setAttachFiles((fs) => [...fs, ...files].slice(0, MAX_COMMENT_ATTACHMENTS));
  };
  const onPasteImage = useImagePaste(addFiles);
  // Autocomplete des mentions @membre (32.B).
  const mentions = useMentions(content, setContent, composerRef);

  // Une annotation (dessin, hotspot, référence) suffit : le texte est optionnel.
  const hasPayload = hints.annotation || hints.hotspot || (hints.references ?? 0) > 0;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!content.trim() && attachFiles.length === 0 && !hasPayload) return;
    setSending(true);
    try {
      if (await onSubmit(content, attachFiles)) {
        clearDraft(mediaObjectId);
        setContent('');
        setAttachFiles([]);
      }
    } finally {
      setSending(false);
    }
  };

  // Entrée = saut de ligne (défaut textarea) ; Ctrl/Cmd+Entrée = envoi.
  // Le menu de mentions consomme flèches/Entrée/Tab/Échap quand il est ouvert.
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentions.onKeyDown(e)) return;
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
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-2.5 text-sm font-semibold">
        <span>
          Commentaires{' '}
          {comments && (
            <span className="font-normal text-muted-foreground">
              · {comments.filter((c) => !c.isResolved).length} ouvert
              {comments.filter((c) => !c.isResolved).length > 1 ? 's' : ''} / {comments.length}
            </span>
          )}
        </span>
        {/* Filtre ouverts/résolus (32.A) */}
        <div className="flex rounded-md border border-border p-0.5">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={`rounded px-1.5 py-0.5 text-[10px] font-normal ${
                filter === f.value
                  ? 'bg-secondary text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
      <div className="custom-scrollbar min-h-0 flex-1 overflow-auto p-4">
        {comments === null ? (
          <SkeletonRows count={4} />
        ) : (
          <ReviewComments
            comments={comments.filter(
              (c) => filter === 'all' || (filter === 'open' ? !c.isResolved : c.isResolved),
            )}
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
        {hints.annotation && (
          <p className="mb-1.5 text-[11px] text-primary">✏️ Annotation jointe (texte optionnel)</p>
        )}
        {(hints.references ?? 0) > 0 && (
          <p className="mb-1.5 text-[11px] text-primary">
            🖼 {hints.references} image{(hints.references ?? 0) > 1 ? 's' : ''} de référence jointe
            {(hints.references ?? 0) > 1 ? 's' : ''}
          </p>
        )}
        {hints.hotspot && (
          <p className="mb-1.5 text-[11px] text-primary">📍 Hotspot joint (centre du viewer)</p>
        )}
        {hints.camera && (
          <p className="mb-1.5 text-[11px] text-primary">📷 La vue caméra actuelle sera enregistrée</p>
        )}
        <div className="relative">
          <MentionMenu mentions={mentions} />
          <Textarea
            ref={composerRef}
            autoGrow
            minRows={2}
            maxRows={10}
            placeholder="Ajouter un commentaire… (Ctrl+Entrée pour envoyer, @ pour mentionner)"
            value={content}
            onChange={(e) => {
              setContent(e.target.value);
              mentions.refresh();
            }}
            onClick={mentions.refresh}
            onKeyDown={onKeyDown}
            onPaste={onPasteImage}
          />
        </div>
        <div className="mt-2 flex items-center justify-between">
          <input
            ref={fileRef}
            type="file"
            accept={ATTACHMENT_ACCEPT}
            multiple
            className="hidden"
            onChange={(e) => {
              addFiles(Array.from(e.target.files ?? []));
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
            {/* Note vocale (32.F) : jointe comme pièce audio, lue inline dans le fil. */}
            <VoiceRecorderButton onRecorded={(f) => addFiles([f])} />
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
        {/* Barre d'outils d'annotation sous l'espace commentaire (activée par « Annoter »). */}
        {annotating && annotationTools && (
          <div className="mt-2 border-t border-border pt-2">{annotationTools}</div>
        )}
      </form>
    </ResizablePanel>
  );
}
