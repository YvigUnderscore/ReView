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
import { ATTACHMENT_ACCEPT, MAX_COMMENT_ATTACHMENTS } from '../../lib/commentAttachments';
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

/** Translator passed to the label tables, recomputed on every render. */
type Tr = (key: MessageKey) => string;

/** Thread resolution filter (32.A). */
type ResolutionFilter = 'all' | 'open' | 'resolved';
const filters = (t: Tr): { value: ResolutionFilter; label: string }[] => [
  { value: 'all', label: t('comments.filter.all') },
  { value: 'open', label: t('comments.filter.open') },
  { value: 'resolved', label: t('comments.filter.resolved') },
];

/**
 * Side comments panel: the list (with a loading skeleton) and the composer (text,
 * attached images, rows of points of interest, annotation/camera/range indicators).
 * Submission is delegated to `onSubmit` (the orchestrator attaches the timestamp, camera
 * and annotations); the panel only clears its input when the submission succeeds.
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
  /** Timeline markers (video) — clickable separators in the thread (feedback 34). */
  markers?: TimelineMarker[];
  onMarkerSeek?: (m: TimelineMarker) => void;
  composerRef: RefObject<HTMLTextAreaElement | null>;
  hints: {
    annotation: boolean;
    camera: boolean;
    /** Attached camera animation (layout mode): replayed when the comment is selected. */
    cameraAnim?: boolean;
    references?: number;
    /** Active I/O loop (34.A): the comment carries the in→out range. */
    range?: boolean;
  };
  onSubmit: (content: string, files: File[]) => Promise<boolean>;
  /** Annotation mode active ("Annotate" button below the field, Phase 24). */
  annotating?: boolean;
  onToggleAnnotate?: () => void;
  /** Points of interest being prepared: one row per point, above the text field. */
  poi?: PoiDraftState;
  /** Camera return to a reviewed point (number clicked in a thread card). */
  onPoiFocus?: (point: PoiPoint, index: number) => void;
  /** Right-click entries specific to this screen (edit: return to the shot review). */
  extraActions?: (comment: ReviewComment) => ReactNode;
}) {
  const t = useT();
  // Local draft (32.C): the text being typed survives a reload/navigation.
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
  // Thumbnails of what is being attached: the file name alone did not allow
  // checking that it was sent ("image (3).png").
  const drafts = toDrafts([], attachFiles, useObjectUrls(attachFiles));
  const dropDraft = (id: string) => setAttachFiles((fs) => removeDraft(id, fs, []).files);
  // Autocomplete for @member mentions (32.B).
  const mentions = useMentions(content, setContent, composerRef);

  // An annotation (drawing, point of interest, reference) is enough: the text is optional.
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

  // Enter = new line (textarea default); Ctrl/Cmd+Enter = send.
  // The mention menu consumes arrows/Enter/Tab/Escape while it is open.
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
        {/* Open/resolved filter (32.A) */}
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
        {/* Points of interest being prepared: their text and images are edited here, where
            the user reads what is about to go out — a single comment carries them all. */}
        {poi && <PoiDraftRows poi={poi} />}
        {hints.range && <p className="mb-1.5 text-xs text-primary">{t('review.rangeAttached')}</p>}
        {hints.camera && <p className="mb-1.5 text-xs text-primary">{t('review.camViewSaved')}</p>}
        {/* The camera animation was nowhere visible once the toast was gone: users sent it
            believing it was attached. The composer lists what is sent, and this is part of it. */}
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
            {/* Voice note (32.F): attached as an audio file, played inline in the thread. */}
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
