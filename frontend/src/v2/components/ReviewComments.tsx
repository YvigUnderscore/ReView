// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Fragment, useState, type ReactNode } from 'react';
import { Eye, EyeOff, Link2, ListTodo } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { api } from '../../lib/apiClient';
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
import type { ReviewComment, TimelineMarker } from '../types/api';
import { useT } from '../i18n';

/** Fil de commentaires de review (racines + réponses imbriquées, clic droit par carte),
 * scandé par les marqueurs de timeline en séparateurs cliquables (retours 34). */
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
}: {
  comments: ReviewComment[];
  mediaObjectId: number;
  currentUserId: number;
  currentUserRole?: string;
  reload: () => void;
  fps: number;
  startFrame: number;
  /** Commentaire actuellement affiché dans le viewer (carte mise en avant). */
  selectedId: number | null;
  /** Sélectionne un commentaire : seek + annotation + caméra restaurés ensemble. */
  onSelect: (c: ReviewComment) => void;
  /** Marqueurs de timeline (34.C, vidéo) — affichés en séparateurs du fil. */
  markers?: TimelineMarker[];
  /** Clic sur un séparateur : seek à la frame du marqueur. */
  onMarkerSeek?: (m: TimelineMarker) => void;
  /**
   * Entrées de menu propres à l'écran, posées en tête du clic droit — le montage y ajoute
   * « renvoyer sur la review du shot ». Les actions communes restent en dessous, à leur
   * place habituelle : un même geste ne doit pas ouvrir un menu différent selon la page.
   */
  extraActions?: (comment: ReviewComment) => ReactNode;
}) {
  const t = useT();
  const navigate = useNavigate();
  const isManager = currentUserRole === 'ADMIN' || currentUserRole === 'SUPERVISOR';
  const canCreateTask = isManager;
  // Filtre du fil (D1) : sur une review chargée, on veut lire ce qui reste ouvert.
  const [filter, setFilter] = useState<CommentState | null>(null);
  const setState = useSetCommentState(mediaObjectId);
  const setVisibility = useSetCommentVisibility(mediaObjectId);

  // Lien profond (32.E) : URL de la review courante ciblant ce commentaire.
  const copyLink = (c: ReviewComment) =>
    void navigator.clipboard
      .writeText(commentLink(window.location.origin, window.location.pathname, c.id))
      .then(() => toast.success(t('comments.linkCopied')))
      .catch(() => toast.error(t('comments.copyFailed')));

  // Commentaire → tâche kanban (32.D) : shot/asset et assigné repris côté backend.
  const createTask = (c: ReviewComment) =>
    void api
      .post<{ task: { id: number; name: string } }>(`/api/comments/${c.id}/task`)
      .then(({ task }) =>
        toast.success(t('task.createdNamed', { name: task.name }), {
          action: {
            label: t('common.open'),
            onClick: () => {
              void navigate(`/tasks/${task.id}`);
            },
          },
        }),
      )
      .catch((e: unknown) => toast.error(e instanceof Error ? e.message : t('version.createFailed')));

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
          <ContextMenuItem onSelect={() => createTask(c)}>
            <ListTodo size={14} /> {t('comments.toTask')}
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );

  const visible = comments.filter((c) => matchesFilter(c, filter));

  return (
    <div className="space-y-2">
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
