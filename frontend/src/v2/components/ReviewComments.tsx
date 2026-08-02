// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Fragment } from 'react';
import { Link2, ListTodo } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { api } from '../../lib/apiClient';
import CommentItem from './comments/CommentItem';
import { markerSections } from './comments/markerSections';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from './ui/context-menu';
import { commentLink } from '../pages/review/deepLink';
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
}) {
  const t = useT();
  const navigate = useNavigate();
  const canCreateTask = currentUserRole === 'ADMIN' || currentUserRole === 'SUPERVISOR';

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
        toast.success(`Tâche créée : ${task.name}`, {
          action: { label: t('common.open'), onClick: () => navigate(`/tasks/${task.id}`) },
        }),
      )
      .catch((e: unknown) => toast.error(e instanceof Error ? e.message : 'Création impossible'));

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

  return (
    <div className="space-y-2">
      {comments.length === 0 && <p className="text-sm text-muted-foreground">{t('comments.empty')}</p>}
      {markerSections(comments, markers ?? [], fps).map((s) =>
        s.marker === null ? (
          <Fragment key="head">{s.comments.map(renderComment)}</Fragment>
        ) : (
          <div key={`marker-${s.marker.id}`} className="space-y-2">
            <button
              onClick={() => onMarkerSeek?.(s.marker!)}
              title={`Aller à la frame ${startFrame + s.marker.frame}${s.marker.authorName ? ` — marqueur de ${s.marker.authorName}` : ''}`}
              className="group flex w-full items-center gap-2 pt-1 text-left"
            >
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: s.marker.color }} />
              <span className="shrink-0 text-[11px] font-medium text-muted-foreground group-hover:text-foreground">
                {s.marker.name}
              </span>
              <span className="h-px min-w-4 flex-1 bg-border" />
              <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
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
