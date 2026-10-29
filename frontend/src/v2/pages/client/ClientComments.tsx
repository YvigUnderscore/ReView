// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState, type ReactNode, type RefObject } from 'react';
import { Clock, PenLine, Send } from 'lucide-react';
import type { ClientComment } from '../../types/api';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Textarea } from '../../components/ui/textarea';
import CommentAttachmentList from '../../components/comments/CommentAttachmentList';
import CollapsibleText from '../../components/comments/CollapsibleText';
import { formatTime, splitAnnotationParts } from '../review/reviewTypes';
import { frameOf } from './clientAnnotation';
import { useT } from '../../i18n';

/**
 * Comment thread of the client page: notes the studio makes visible to the client,
 * timestamped when they target a video (click = seek), and a composer for links with
 * COMMENT permission. Guests have no account: their name is entered once and stored
 * locally, and nothing more is asked.
 */
export default function ClientComments({
  comments,
  canComment,
  timed,
  fps,
  startFrame,
  selectedId,
  onSelect,
  onSeek,
  onSubmit,
  composerRef,
  annotationBar,
  hasAnnotation,
  guestName,
  onGuestName,
  decision,
}: {
  comments: ClientComment[];
  canComment: boolean;
  /** The media has a time axis (video): shows and makes the timestamp clickable. */
  timed: boolean;
  /** Project frame rate and start frame: enough to cite a FRAME NUMBER, not a duration. */
  fps: number;
  startFrame: number;
  /** Note whose drawing is shown on the viewer. */
  selectedId: number | null;
  /** Selected note: replays its drawing and position together. */
  onSelect: (comment: ClientComment) => void;
  /** Position within the **media** (excluding slate) requested by a timestamp click. */
  onSeek: (mediaSeconds: number) => void;
  onSubmit: (guestName: string, content: string) => Promise<void>;
  composerRef: RefObject<HTMLTextAreaElement | null>;
  /** Drawing tools, placed BELOW the field, where the internal review puts its own. */
  annotationBar?: ReactNode;
  /** An in-progress drawing is enough to send: the text becomes optional. */
  hasAnnotation: boolean;
  /** The name the guest speaks under, shared with their reply rather than duplicated here. */
  guestName: string;
  onGuestName: (name: string) => void;
  /** "Your reply" block, placed above the thread when the link allows a verdict. */
  decision?: ReactNode;
}) {
  const t = useT();
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    // A drawing is feedback in itself: require text only when there is nothing else to send.
    if (!guestName.trim() || (!content.trim() && !hasAnnotation) || busy) return;
    setBusy(true);
    try {
      await onSubmit(guestName.trim(), content.trim());
      setContent('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="flex w-full flex-col rounded-lg border border-border bg-card lg:w-80">
      {/* The reply goes BEFORE the thread: that is what is expected of the client, and the note
          backs it up. */}
      {decision}
      <h2 className="border-b border-border px-4 py-3 text-sm font-semibold">{t('admin.tab.comments')}</h2>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {comments.length === 0 && <p className="text-sm text-muted-foreground">{t('comments.empty')}</p>}
        {comments.map((c) => {
          // A note carrying a drawing is flagged: without a cue, the client would not know
          // that clicking it shows a stroke on the image.
          const hasDrawing = splitAnnotationParts(c.annotation).shapes.length > 0;
          return (
            <div
              key={c.id}
              onClick={() => onSelect(c)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') onSelect(c);
              }}
              className={`cursor-pointer rounded-md p-2.5 text-sm transition-colors ${
                selectedId === c.id ? 'bg-primary/15 ring-1 ring-primary/40' : 'bg-secondary/40'
              }`}
            >
              <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">
                  {c.author?.name ?? c.guestName ?? t('comments.anonymous')}
                </span>
                {hasDrawing && <PenLine size={11} aria-label={t('comments.annotate')} />}
                {c.timestamp != null && timed && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onSeek(c.timestamp!);
                    }}
                    className="flex items-center gap-1 rounded bg-primary/15 px-1.5 py-0.5 text-primary hover:bg-primary/25"
                  >
                    {/* A studio speaks in frames. The time stays readable for whoever scrubs, while the
                      number is what the artist finds in their software. */}
                    <Clock size={11} /> {formatTime(c.timestamp)} · {frameOf(c.timestamp, fps, startFrame)}
                  </button>
                )}
              </div>
              {/* Content already sanitized server-side (sanitizeHtml): displayed as plain text,
                  collapsed by default if too large (D6). */}
              <CollapsibleText text={c.content}>
                <p className="whitespace-pre-wrap break-words">{c.content.replace(/<[^>]+>/g, '')}</p>
              </CollapsibleText>
              {/* Images attached by the studio: invisible to the client until now, for lack of being
                  served AND rendered. Same thumbnails and same carousel as on the studio side. */}
              {c.attachments && c.attachments.length > 0 && (
                <CommentAttachmentList attachments={c.attachments} stop={(e) => e.stopPropagation()} />
              )}
            </div>
          );
        })}
      </div>
      {canComment && (
        <form onSubmit={submit} className="space-y-2 border-t border-border p-3">
          <Input
            value={guestName}
            onChange={(e) => onGuestName(e.target.value)}
            placeholder={t('setup.adminName')}
            aria-label={t('setup.adminName')}
            maxLength={80}
            required
          />
          <Textarea
            ref={composerRef}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={timed ? t('client.commentAtFrame') : t('client.yourComment')}
            aria-label={timed ? t('client.commentAtFrame') : t('client.yourComment')}
            rows={3}
            maxLength={10000}
          />
          {annotationBar}
          <Button
            type="submit"
            size="sm"
            disabled={busy || (!content.trim() && !hasAnnotation)}
            className="w-full"
          >
            <Send size={13} className="mr-1" /> {t('common.send')}
          </Button>
        </form>
      )}
    </aside>
  );
}
