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
  /** Retour caméra sur un point d'intérêt de ce commentaire (numéro cliqué). */
  onPoiFocus?: (point: PoiPoint, index: number) => void;
}

/** Un commentaire de review (badges frame/caméra/annotation, réactions, réponses, édition). */
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
  // Fil long (D6) : seules les dernières réponses sont rendues tant qu'on n'a pas déplié.
  const [allReplies, setAllReplies] = useState(false);

  const isAuthor = c.author?.id === currentUserId;
  const isManager = currentUserRole === 'ADMIN' || currentUserRole === 'SUPERVISOR';
  const canEdit = isAuthor;
  const canDelete = isAuthor || isManager;
  // Résolution (32.A) : auteur ou superviseur/admin, sur les commentaires racine.
  const canResolve = !isReply && (isAuthor || isManager);

  // Les mutations passaient par un `catch {}` vide : sans droit ou sans réseau, le bouton
  // ne produisait rien du tout — ni erreur, ni changement (D1).
  const setState = useSetCommentState(mediaObjectId);
  const del = useDeleteComment(mediaObjectId);
  const state = stateOf(c);

  const applyState = (next: CommentState) =>
    setState.mutate({ id: c.id, state: next }, { onSuccess: () => reload() });

  const remove = () => del.mutate(c.id, { onSuccess: () => reload() });
  const { hidden, shown } = splitReplies(c.replies ?? []);
  const replies = allReplies ? (c.replies ?? []) : shown;

  const hasAnnotation = Array.isArray(c.annotation) && c.annotation.length > 0;
  // Points d'intérêt portés par CE commentaire : rendus en rangées numérotées, et retirés du
  // texte — le bloc numéroté y est recopié pour tout ce qui ne lit que `content` (portail
  // client, export de notes, ShotGrid), il n'a pas à s'afficher deux fois ici.
  const poiPoints = readPoiPoints(c.annotation);
  const body = stripPoiBlock(c.content, poiPoints);
  const selected = selectedId === c.id;
  const selectable = !isReply && (c.timestamp != null || c.cameraState != null || hasAnnotation);
  // Empêche un clic sur une action interne de déclencher la sélection de la carte. Les
  // conteneurs qui le portent sont purement présentationnels (`role="presentation"`) : ils
  // ne sont pas des contrôles, les boutons et champs qu'ils enveloppent restent focusables.
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  // Équivalent clavier du clic sur la carte sélectionnable.
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
      {/* Le bouton de résolution vit dans le coin haut droit de la carte : dans la rangée
          d'actions, il se perdait entre « répondre » et « modifier ». Les autres états
          passent par le clic droit — cinq boutons par carte ne se lisent pas. */}
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
          /* Un commentaire trop grand s'ouvre replié (D6) — texte entier conservé dans le
             document, donc toujours trouvable par une recherche. */
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

        {/* Pièces jointes : 2 vignettes max + tuile « +x images » (lightbox), chips PDF/zip/texte */}
        {!editing && Array.isArray(c.attachments) && c.attachments.length > 0 && (
          <CommentAttachmentList attachments={c.attachments} stop={stop} />
        )}

        {/* Réactions + actions */}
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

        {/* Réponses : les dernières d'abord, le reste sur un clic (D6) */}
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
