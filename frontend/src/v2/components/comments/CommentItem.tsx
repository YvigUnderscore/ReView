// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { MessagesSquare, Reply, Pencil, Trash2, CheckCircle2, RotateCcw } from 'lucide-react';
import Avatar from '../Avatar';
import ReplyComposer from './ReplyComposer';
import CommentReactions from './CommentReactions';
import CommentAttachmentList from './CommentAttachmentList';
import CommentEditForm from './CommentEditForm';
import CollapsibleText from './CollapsibleText';
import { splitReplies } from './collapse';
import { highlightMentions } from './mentions';
import CommentMeta from './CommentMeta';
import { STATE_CARD_CLASS, isClosed, stateOf, toggleState, type CommentState } from './commentState';
import { useDeleteComment, useSetCommentState } from '../../lib/commentsApi';
import type { ReviewComment } from '../../types/api';
import PoiCommentPoints from '../../pages/review/poi/PoiCommentPoints';
import { readPoiPoints, stripPoiBlock, type PoiPoint } from '../../pages/review/poi/poiPoints';
import { splatEditBlobKeys } from '../../pages/review/splat/splatEditPart';
import { useT } from '../../i18n';

export interface CommentItemProps {
  comment: ReviewComment;
  mediaObjectId: number;
  currentUserId: number;
  currentUserRole?: string;
  reload: () => void;
  fps: number;
  startFrame: number;
  selectedId: number | null;
  onSelect: (c: ReviewComment) => void;
  isReply?: boolean;
  /** Camera return to a point of interest of this comment (clicked number). */
  onPoiFocus?: (point: PoiPoint, index: number) => void;
}

/** A review comment (frame/camera/annotation badges, reactions, replies, editing). */
export default function CommentItem({
  comment: c,
  mediaObjectId,
  currentUserId,
  currentUserRole,
  reload,
  fps,
  startFrame,
  selectedId,
  onSelect,
  isReply = false,
  onPoiFocus,
}: CommentItemProps) {
  const t = useT();
  const [replying, setReplying] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Long thread (D6): only the latest replies are rendered until expanded.
  const [allReplies, setAllReplies] = useState(false);

  const isAuthor = c.author?.id === currentUserId;
  const isManager = currentUserRole === 'ADMIN' || currentUserRole === 'SUPERVISOR';
  const canEdit = isAuthor;
  const canDelete = isAuthor || isManager;
  // Resolution (32.A): author or supervisor/admin, on root comments.
  const canResolve = !isReply && (isAuthor || isManager);

  // The mutations used to go through an empty `catch {}`: without rights or network, the button
  // did nothing at all, neither an error nor a change (D1).
  const setState = useSetCommentState(mediaObjectId);
  const del = useDeleteComment(mediaObjectId);
  const state = stateOf(c);

  const applyState = (next: CommentState) =>
    setState.mutate({ id: c.id, state: next }, { onSuccess: () => reload() });

  const remove = () => del.mutate(c.id, { onSuccess: () => reload() });
  const { hidden, shown } = splitReplies(c.replies ?? []);
  const replies = allReplies ? (c.replies ?? []) : shown;

  const hasAnnotation = Array.isArray(c.annotation) && c.annotation.length > 0;
  // Points of interest carried by THIS comment: rendered as numbered rows, and removed from the
  // text. The numbered block is copied into everything that reads only `content` (client portal,
  // notes export, ShotGrid), so it need not be shown twice here.
  const poiPoints = readPoiPoints(c.annotation);
  const body = stripPoiBlock(c.content, poiPoints);
  // A cloud edit proposal stores its mask and ops as attachments, which is what gives them their
  // purging. They have nothing to do in the comment's file list: a bitset cannot be opened.
  // Excluded by their key, never by their type.
  const blobKeys = splatEditBlobKeys(c.annotation);
  const attachments = Array.isArray(c.attachments)
    ? c.attachments.filter((a) => !a.key || !blobKeys.includes(a.key))
    : [];
  const selected = selectedId === c.id;
  const selectable = !isReply && (c.timestamp != null || c.cameraState != null || hasAnnotation);
  // Prevents a click on an internal action from triggering the card's selection. The containers
  // carrying it are purely presentational (`role="presentation"`): they are not controls, and
  // the buttons and fields they wrap stay focusable.
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  // Keyboard equivalent of clicking the selectable card.
  const onCardKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    onSelect(c);
  };

  return (
    <div
      role={selectable ? 'button' : undefined}
      tabIndex={selectable ? 0 : undefined}
      onClick={selectable ? () => onSelect(c) : undefined}
      onKeyDown={selectable ? onCardKeyDown : undefined}
      className={
        isReply
          ? 'flex gap-2.5'
          : `group relative flex gap-2.5 rounded-lg border p-2.5 transition-colors ${
              isClosed(state) ? 'opacity-70' : ''
            } ${
              selected
                ? 'border-primary/60 bg-primary/[0.06] shadow-sm'
                : `${STATE_CARD_CLASS[state]} ${selectable ? 'cursor-pointer hover:border-border hover:bg-secondary/60' : ''}`
            }`
      }
    >
      {/* The resolve button lives in the top-right corner of the card: in the row of actions it
          got lost between "reply" and "edit". Other states go through right-click, since five
          buttons per card are hard to read. */}
      {canResolve && (
        <button
          onClick={(e) => {
            stop(e);
            applyState(toggleState(state));
          }}
          disabled={setState.isPending}
          title={state === 'RESOLVED' ? t('comment.reopen') : t('comment.markResolved')}
          aria-label={state === 'RESOLVED' ? t('comment.reopen') : t('comment.markResolved')}
          className={`absolute right-1.5 top-1.5 rounded p-1 transition-opacity hover:bg-secondary ${
            state === 'RESOLVED'
              ? 'text-success'
              : 'text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
          }`}
        >
          {state === 'RESOLVED' ? <RotateCcw size={13} /> : <CheckCircle2 size={14} />}
        </button>
      )}
      <Avatar
        seed={c.author?.id ?? c.guestName ?? 'g'}
        initials={c.author?.initials ?? (c.guestName ?? '?').slice(0, 2).toUpperCase()}
        avatarUrl={c.author?.avatarUrl}
        size={isReply ? 24 : 30}
      />
      <div className="min-w-0 flex-1">
        <CommentMeta comment={c} state={state} fps={fps} startFrame={startFrame} />

        {editing ? (
          <div role="presentation" onClick={stop}>
            <CommentEditForm
              comment={c}
              mediaObjectId={mediaObjectId}
              onDone={() => {
                setEditing(false);
                reload();
              }}
              onCancel={() => setEditing(false)}
            />
          </div>
        ) : (
          /* A comment that is too large opens collapsed (D6): the full text is kept in the
             document, so it can always be found by search. */
          <>
            {body && (
              <CollapsibleText text={body}>
                <div
                  className="prose-doc mt-0.5 max-w-none whitespace-pre-wrap text-sm"
                  dangerouslySetInnerHTML={{ __html: highlightMentions(body) }}
                />
              </CollapsibleText>
            )}
            <PoiCommentPoints
              points={poiPoints}
              attachments={c.attachments}
              onFocus={onPoiFocus}
              stop={stop}
            />
          </>
        )}

        {/* Attachments: 2 thumbnails max + "+x images" tile (lightbox), PDF/zip/text chips */}
        {!editing && attachments.length > 0 && (
          <CommentAttachmentList attachments={attachments} stop={stop} />
        )}

        {/* Reactions + actions */}
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          <CommentReactions comment={c} currentUserId={currentUserId} reload={reload} stop={stop} />
          {!isReply && (
            <button
              onClick={(e) => {
                stop(e);
                setReplying((r) => !r);
              }}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              <Reply size={13} /> {t('comments.reply2')}
            </button>
          )}
          {canEdit && !editing && (
            <button
              onClick={(e) => {
                stop(e);
                setEditing(true);
              }}
              title={t('common.edit')}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              <Pencil size={12} />
            </button>
          )}
          {canDelete &&
            (confirmDelete ? (
              <span role="presentation" onClick={stop} className="flex items-center gap-1 text-xs">
                <button
                  onClick={remove}
                  className="rounded bg-destructive px-1.5 py-0.5 text-destructive-foreground"
                >
                  {t('common.delete')}
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="rounded px-1.5 py-0.5 text-muted-foreground hover:bg-secondary"
                >
                  {t('common.cancel')}
                </button>
              </span>
            ) : (
              <button
                onClick={(e) => {
                  stop(e);
                  setConfirmDelete(true);
                }}
                title={t('common.delete')}
                className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-secondary hover:text-destructive"
              >
                <Trash2 size={12} />
              </button>
            ))}
        </div>

        {/* Replies: the latest first, the rest on click (D6) */}
        {replies.length > 0 && (
          <div className="mt-2 space-y-1 border-l border-border pl-2">
            {hidden.length > 0 && (
              <button
                onClick={(e) => {
                  stop(e);
                  setAllReplies((a) => !a);
                }}
                className="flex items-center gap-1 text-2xs text-muted-foreground hover:text-foreground"
              >
                <MessagesSquare size={12} />
                {allReplies
                  ? t('comments.hideEarlierReplies')
                  : t('comments.showEarlierReplies', { count: hidden.length })}
              </button>
            )}
            {replies.map((r) => (
              <CommentItem
                key={r.id}
                comment={r}
                mediaObjectId={mediaObjectId}
                currentUserId={currentUserId}
                currentUserRole={currentUserRole}
                reload={reload}
                fps={fps}
                startFrame={startFrame}
                selectedId={selectedId}
                onSelect={onSelect}
                onPoiFocus={onPoiFocus}
                isReply
              />
            ))}
          </div>
        )}

        {replying && (
          <div role="presentation" onClick={stop}>
            <ReplyComposer
              mediaObjectId={c.mediaObjectId ?? mediaObjectId}
              parentId={c.id}
              onSent={() => {
                setReplying(false);
                reload();
              }}
              onCancel={() => setReplying(false)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
