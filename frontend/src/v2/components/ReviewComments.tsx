// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Fragment, useState, type ReactNode } from 'react';
import { Eye, EyeOff, Link2, ListTodo } from 'lucide-react';
import { toast } from 'sonner';
import CommentItem from './comments/CommentItem';
import { markerSections } from './comments/markerSections';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from './ui/context-menu';
import { commentLink } from '../pages/review/deepLink';
import {
  COMMENT_STATES,
  STATE_DOT_CLASS,
  STATE_LABEL_KEY,
  matchesFilter,
  stateOf,
  type CommentState,
} from './comments/commentState';
import { useSetCommentState, useSetCommentVisibility } from '../lib/commentsApi';
import { useCommentTaskDialog } from '../lib/useCommentTaskDialog';
import { useProjectRole } from '../lib/useProjectRole';
import { useProjectContext } from '../stores/useProjectContext';
import type { ReviewComment, TimelineMarker } from '../types/api';
import type { PoiPoint } from '../pages/review/poi/poiPoints';
import { useT } from '../i18n';

/** Review comment thread (roots + nested replies, right click per card),
 * scanned by timeline markers as clickable separators (feedback 34). */
export default function ReviewComments({
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
  extraActions,
  onPoiFocus,
}: {
  comments: ReviewComment[];
  mediaObjectId: number;
  currentUserId: number;
  currentUserRole?: string;
  reload: () => void;
  fps: number;
  startFrame: number;
  /** Comment currently displayed in the viewer (highlighted card). */
  selectedId: number | null;
  /** Selects a comment: seek + annotation + camera restored together. */
  onSelect: (c: ReviewComment) => void;
  /** Timeline markers (34.C, video): displayed as separators of the thread. */
  markers?: TimelineMarker[];
  /** Click on a separator: seek to the marker's frame. */
  onMarkerSeek?: (m: TimelineMarker) => void;
  /**
   * Screen-specific menu entries, placed at the top of the right click; the mount adds to them
   * "send back to the shot's review". The common actions remain below, in their
   * usual place: one gesture must not open a different menu depending on the page.
   */
  extraActions?: (comment: ReviewComment) => ReactNode;
  /** Camera return to a point of interest re-read (number clicked in a card). */
  onPoiFocus?: (point: PoiPoint, index: number) => void;
}) {
  const t = useT();
  const isManager = currentUserRole === 'ADMIN' || currentUserRole === 'SUPERVISOR';
  /**
   * Creating a task from a feedback is a production gesture, and the right to do so is read from
   * the project's EFFECTIVE role: the account's GLOBAL role hid the entry from a supervisor
   * named on THAT project, whom the server does authorize.
   */
  const projectId = useProjectContext((s) => s.projectId);
  const { canManage: canCreateTask } = useProjectRole(projectId ?? 0);
  // The name is asked BEFORE creation (Phase 50): it is what one reads on the kanban.
  const commentTask = useCommentTaskDialog();
  // Thread filter (D1): on a loaded review, one wants to read what remains open.
  const [filter, setFilter] = useState<CommentState | null>(null);
  const setState = useSetCommentState(mediaObjectId);
  const setVisibility = useSetCommentVisibility(mediaObjectId);

  // Deep link (32.E): URL of the current review targeting this comment.
  const copyLink = (c: ReviewComment) =>
    void navigator.clipboard
      .writeText(commentLink(window.location.origin, window.location.pathname, c.id))
      .then(() => toast.success(t('comments.linkCopied')))
      .catch(() => toast.error(t('comments.copyFailed')));

  const renderComment = (c: ReviewComment) => (
    <ContextMenu key={c.id}>
      <ContextMenuTrigger asChild>
        <div id={`comment-${c.id}`}>
          <CommentItem
            comment={c}
            mediaObjectId={mediaObjectId}
            currentUserId={currentUserId}
            currentUserRole={currentUserRole}
            reload={reload}
            fps={fps}
            startFrame={startFrame}
            selectedId={selectedId}
            onSelect={onSelect}
            onPoiFocus={onPoiFocus}
          />
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        {extraActions?.(c)}
        {/* Les états passent par le clic droit : cinq boutons par carte ne se lisent pas. */}
        {COMMENT_STATES.filter((s) => s !== stateOf(c)).map((s) => (
          <ContextMenuItem
            key={s}
            onSelect={() => setState.mutate({ id: c.id, state: s }, { onSuccess: reload })}
          >
            <span className={`h-2 w-2 rounded-full ${STATE_DOT_CLASS[s]}`} /> {t(STATE_LABEL_KEY[s])}
          </ContextMenuItem>
        ))}
        {isManager && (
          <ContextMenuItem
            onSelect={() =>
              setVisibility.mutate(
                { id: c.id, isVisibleToClient: !c.isVisibleToClient },
                { onSuccess: reload },
              )
            }
          >
            {c.isVisibleToClient ? <EyeOff size={14} /> : <Eye size={14} />}{' '}
            {c.isVisibleToClient ? t('comment.hideFromClient') : t('comment.showToClient')}
          </ContextMenuItem>
        )}
        <ContextMenuItem onSelect={() => copyLink(c)}>
          <Link2 size={14} /> {t('comments.copyLink')}
        </ContextMenuItem>
        {canCreateTask && (
          <ContextMenuItem onSelect={() => commentTask.open(c)}>
            <ListTodo size={14} /> {t('comments.toTask')}
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );

  const visible = comments.filter((c) => matchesFilter(c, filter));

  return (
    <div className="space-y-2">
      {commentTask.dialog}
      {comments.length > 1 && (
        <div className="flex flex-wrap items-center gap-1">
          <button
            onClick={() => setFilter(null)}
            className={`rounded-full px-2 py-0.5 text-2xs transition-colors ${
              filter === null ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t('comments.filter.all')}
          </button>
          {COMMENT_STATES.map((s) => {
            const count = comments.filter((c) => stateOf(c) === s).length;
            if (count === 0) return null;
            return (
              <button
                key={s}
                onClick={() => setFilter(filter === s ? null : s)}
                className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-2xs transition-colors ${
                  filter === s
                    ? 'bg-secondary text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${STATE_DOT_CLASS[s]}`} />
                {t(STATE_LABEL_KEY[s])} {count}
              </button>
            );
          })}
        </div>
      )}
      {comments.length === 0 && <p className="text-sm text-muted-foreground">{t('comments.empty')}</p>}
      {comments.length > 0 && visible.length === 0 && (
        <p className="text-sm text-muted-foreground">{t('comments.filter.none')}</p>
      )}
      {markerSections(visible, markers ?? [], fps).map((s) =>
        s.marker === null ? (
          <Fragment key="head">{s.comments.map(renderComment)}</Fragment>
        ) : (
          <div key={`marker-${s.marker.id}`} className="space-y-2">
            <button
              onClick={() => onMarkerSeek?.(s.marker!)}
              title={
                s.marker.authorName
                  ? t('marker.goToFrameBy', {
                      frame: startFrame + s.marker.frame,
                      name: s.marker.authorName,
                    })
                  : t('marker.goToFrame', { frame: startFrame + s.marker.frame })
              }
              className="group flex w-full items-center gap-2 pt-1 text-left"
            >
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: s.marker.color }} />
              <span className="shrink-0 text-xs font-medium text-muted-foreground group-hover:text-foreground">
                {s.marker.name}
              </span>
              <span className="h-px min-w-4 flex-1 bg-border" />
              <span className="shrink-0 font-mono text-2xs text-muted-foreground">
                {startFrame + s.marker.frame}
              </span>
            </button>
            {s.comments.map(renderComment)}
          </div>
        ),
      )}
    </div>
  );
}
