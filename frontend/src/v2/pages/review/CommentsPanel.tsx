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
import { ImagePlus, PencilLine } from 'lucide-react';
import { toast } from 'sonner';
import { ATTACHMENT_ACCEPT, MAX_COMMENT_ATTACHMENTS } from '../../../lib/commentAttachments';
import AttachmentDraftList from '../../components/comments/AttachmentDraftList';
import { removeDraft, toDrafts } from '../../components/comments/attachmentDrafts';
import { useObjectUrls } from '../../components/comments/useObjectUrls';
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
import PoiDraftRows from './poi/PoiDraftRows';
import type { PoiDraftState } from './poi/usePoiDraft';
import type { PoiPoint } from './poi/poiPoints';
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
 * Panneau latéral des commentaires : liste (avec skeleton de chargement) + composer (texte,
 * images jointes, rangées des points d'intérêt, indicateurs d'annotation/caméra/plage).
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
  poi,
  onPoiFocus,
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
    camera: boolean;
    /** Animation caméra jointe (mode layout) : elle sera rejouée à la sélection du commentaire. */
    cameraAnim?: boolean;
    references?: number;
    /** Boucle I/O active (34.A) : le commentaire portera la plage in→out. */
    range?: boolean;
  };
  onSubmit: (content: string, files: File[]) => Promise<boolean>;
  /** Mode annotation actif (bouton « Annoter » sous le champ, Phase 24). */
  annotating?: boolean;
  onToggleAnnotate?: () => void;
  /** Points d'intérêt en préparation : une rangée par point, au-dessus du champ de texte. */
  poi?: PoiDraftState;
  /** Retour caméra sur un point relu (numéro cliqué dans une carte du fil). */
  onPoiFocus?: (point: PoiPoint, index: number) => void;
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
  // Vignettes de ce qu'on est en train de joindre : le nom de fichier seul ne permettait pas
  // de vérifier son envoi (« image (3).png »).
  const drafts = toDrafts([], attachFiles, useObjectUrls(attachFiles));
  const dropDraft = (id: string) => setAttachFiles((fs) => removeDraft(id, fs, []).files);
  // Autocomplete des mentions @membre (32.B).
  const mentions = useMentions(content, setContent, composerRef);

  // Une annotation (dessin, point d'intérêt, référence) suffit : le texte est optionnel.
  const hasPayload = hints.annotation || (poi?.points.length ?? 0) > 0 || (hints.references ?? 0) > 0;
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
            onPoiFocus={onPoiFocus}
          />
        )}
      </div>
      <form onSubmit={submit} className="shrink-0 border-t border-border p-3">
        {drafts.length > 0 && <AttachmentDraftList drafts={drafts} onRemove={dropDraft} />}
        {hints.annotation && (
          <p className="mb-1.5 text-xs text-primary">{t('comment.annotationAttachedHint')}</p>
        )}
        {(hints.references ?? 0) > 0 && (
          <p className="mb-1.5 text-xs text-primary">
            🖼 {t('comment.referencesAttached', { count: hints.references ?? 0 })}
          </p>
        )}
        {/* Points d'intérêt en préparation : leur texte et leurs images se règlent ici, où l'on
            lit ce qui va partir — un seul commentaire les emporte tous. */}
        {poi && <PoiDraftRows poi={poi} />}
        {hints.range && <p className="mb-1.5 text-xs text-primary">{t('review.rangeAttached')}</p>}
        {hints.camera && <p className="mb-1.5 text-xs text-primary">{t('review.camViewSaved')}</p>}
        {/* L'animation caméra ne se voyait nulle part une fois le toast passé : on envoyait en
            croyant l'avoir jointe. Le composeur énumère ce qui part, elle en fait partie. */}
        {hints.cameraAnim && <p className="mb-1.5 text-xs text-primary">{t('review.camera.animAttached')}</p>}
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
