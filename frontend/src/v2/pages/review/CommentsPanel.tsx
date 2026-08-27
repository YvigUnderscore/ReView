// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

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
import type { ReviewComment, TimelineMarker } from '../../types/api';
import { SkeletonRows } from '../../components/ui/skeleton';
import { Textarea } from '../../components/ui/textarea';
import { ResizablePanel } from '../../components/ui/resizable';
import { useImagePaste } from '../../lib/useImagePaste';
import { useMentions } from '../../components/comments/useMentions';
import MentionMenu from '../../components/comments/MentionMenu';
import VoiceRecorderButton from '../../components/comments/VoiceRecorderButton';
import { clearDraft, loadDraft, saveDraft } from './commentDraft';
import { useT, type MessageKey } from '../../i18n';

/** Traducteur passé aux tables de libellés, recalculées à chaque rendu. */
type Tr = (key: MessageKey) => string;

/** Filtre de résolution du fil (32.A). */
type ResolutionFilter = 'all' | 'open' | 'resolved';
const filters = (t: Tr): { value: ResolutionFilter; label: string }[] => [
  { value: 'all', label: t('comments.filter.all') },
  { value: 'open', label: t('comments.filter.open') },
  { value: 'resolved', label: t('comments.filter.resolved') },
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
  markers,
  onMarkerSeek,
  composerRef,
  hints,
  onSubmit,
  annotating,
  onToggleAnnotate,
  extraActions,
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
  /** Marqueurs de timeline (vidéo) — séparateurs cliquables du fil (retours 34). */
  markers?: TimelineMarker[];
  onMarkerSeek?: (m: TimelineMarker) => void;
  composerRef: RefObject<HTMLTextAreaElement | null>;
  hints: {
    annotation: boolean;
    hotspot: boolean;
    camera: boolean;
    references?: number;
    /** Boucle I/O active (34.A) : le commentaire portera la plage in→out. */
    range?: boolean;
  };
  onSubmit: (content: string, files: File[]) => Promise<boolean>;
  /** Mode annotation actif (bouton « Annoter » sous le champ, Phase 24). */
  annotating?: boolean;
  onToggleAnnotate?: () => void;
  /** Entrées de clic droit propres à l'écran (montage : renvoyer sur la review du shot). */
  extraActions?: (comment: ReviewComment) => ReactNode;
}) {
  const t = useT();
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
      toast.warning(t('comment.maxAttachments', { count: MAX_COMMENT_ATTACHMENTS }));
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
      void submit(e);
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
          {t('comments.title')}{' '}
          {comments && (
            <span className="font-normal text-muted-foreground">
              · {t('comments.openCount', { count: comments.filter((c) => !c.isResolved).length })} /{' '}
              {comments.length}
            </span>
          )}
        </span>
        {/* Filtre ouverts/résolus (32.A) */}
        <div className="flex rounded-md border border-border p-0.5">
          {filters(t).map((f) => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={`rounded px-1.5 py-0.5 text-2xs font-normal ${
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
            markers={markers}
            onMarkerSeek={onMarkerSeek}
            extraActions={extraActions}
          />
        )}
      </div>
      <form onSubmit={submit} className="shrink-0 border-t border-border p-3">
        {attachFiles.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1">
            {attachFiles.map((f, i) => (
              <span key={i} className="flex items-center gap-1 rounded bg-secondary px-1.5 py-0.5 text-2xs">
                {f.name}
                <button type="button" onClick={() => setAttachFiles((fs) => fs.filter((_, j) => j !== i))}>
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
        )}
        {hints.annotation && (
          <p className="mb-1.5 text-xs text-primary">{t('comment.annotationAttachedHint')}</p>
        )}
        {(hints.references ?? 0) > 0 && (
          <p className="mb-1.5 text-xs text-primary">
            🖼 {t('comment.referencesAttached', { count: hints.references ?? 0 })}
          </p>
        )}
        {hints.hotspot && <p className="mb-1.5 text-xs text-primary">{t('review.hotspotAttached')}</p>}
        {hints.range && <p className="mb-1.5 text-xs text-primary">{t('review.rangeAttached')}</p>}
        {hints.camera && <p className="mb-1.5 text-xs text-primary">{t('review.camViewSaved')}</p>}
        <div className="relative">
          <MentionMenu mentions={mentions} />
          <Textarea
            ref={composerRef}
            autoGrow
            minRows={2}
            maxRows={10}
            placeholder={t('comments.placeholder')}
            aria-label={t('comments.placeholder')}
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
              title={t('comments.attachImage')}
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
                title={t('comments.annotate')}
                className={`flex items-center gap-1 rounded-md px-2 py-1.5 text-xs ${
                  annotating
                    ? 'bg-primary/20 text-primary'
                    : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                }`}
              >
                <PencilLine size={15} /> {t('mode.annotate')}
              </button>
            )}
          </div>
          <button
            type="submit"
            disabled={sending}
            className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {sending ? t('common.sending') : t('common.send')}
          </button>
        </div>
      </form>
    </ResizablePanel>
  );
}
