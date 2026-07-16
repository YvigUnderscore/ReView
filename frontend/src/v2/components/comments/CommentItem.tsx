import { useState } from 'react';
import { Reply, Camera, PenLine, Film, Pencil, Trash2, Check } from 'lucide-react';
import { api } from '../../../lib/apiClient';
import Avatar from '../Avatar';
import ReplyComposer from './ReplyComposer';
import CommentReactions from './CommentReactions';
import CommentAttachmentList from './CommentAttachmentList';
import type { ReviewComment } from '../../types/api';

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
}: CommentItemProps) {
  const [replying, setReplying] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const isAuthor = c.author?.id === currentUserId;
  const isManager = currentUserRole === 'ADMIN' || currentUserRole === 'SUPERVISOR';
  const canEdit = isAuthor;
  const canDelete = isAuthor || isManager;

  const startEdit = () => {
    // Édition en texte brut (le HTML stocké provient d'une saisie texte)
    const tmp = document.createElement('div');
    tmp.innerHTML = c.content;
    setEditText(tmp.textContent ?? '');
    setEditing(true);
  };
  const saveEdit = async () => {
    try {
      await api.patch(`/api/comments/${c.id}`, { content: editText });
      setEditing(false);
      reload();
    } catch {
      /* ignore */
    }
  };
  const remove = async () => {
    try {
      await api.del(`/api/comments/${c.id}`);
      reload();
    } catch {
      /* ignore */
    }
  };

  const hasAnnotation = Array.isArray(c.annotation) && c.annotation.length > 0;
  const selected = selectedId === c.id;
  const selectable = !isReply && (c.timestamp != null || c.cameraState != null || hasAnnotation);
  // Empêche un clic sur une action interne de déclencher la sélection de la carte.
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div
      onClick={selectable ? () => onSelect(c) : undefined}
      className={
        isReply
          ? 'flex gap-2.5'
          : `group flex gap-2.5 rounded-lg border p-2.5 transition-colors ${
              selected
                ? 'border-primary/60 bg-primary/[0.06] shadow-sm'
                : `border-border/60 bg-secondary/30 ${selectable ? 'cursor-pointer hover:border-border hover:bg-secondary/60' : ''}`
            }`
      }
    >
      <Avatar
        seed={c.author?.id ?? c.guestName ?? 'g'}
        initials={c.author?.initials ?? (c.guestName ?? '?').slice(0, 2).toUpperCase()}
        avatarUrl={c.author?.avatarUrl}
        size={isReply ? 24 : 30}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-sm font-medium">
            {c.author?.displayName ?? c.author?.name ?? c.guestName ?? 'Anonyme'}
          </span>
          <span className="text-[10px] text-muted-foreground">{new Date(c.createdAt).toLocaleString()}</span>
          {/* Badges indicateurs : la carte entière est cliquable pour tout restaurer. */}
          {c.timestamp != null && (
            <span className="inline-flex items-center gap-1 rounded bg-primary/15 px-1.5 py-0.5 font-mono text-[11px] text-primary">
              <Film size={10} /> F{startFrame + Math.round(c.timestamp * fps)}
            </span>
          )}
          {c.cameraState != null && (
            <span
              title="Vue caméra enregistrée"
              className="inline-flex items-center rounded bg-secondary px-1.5 py-0.5 text-[11px] text-muted-foreground"
            >
              <Camera size={11} />
            </span>
          )}
          {hasAnnotation && (
            <span
              title="Annotation jointe"
              className="inline-flex items-center rounded bg-secondary px-1.5 py-0.5 text-[11px] text-muted-foreground"
            >
              <PenLine size={11} />
            </span>
          )}
        </div>

        {editing ? (
          <div onClick={stop} className="mt-1">
            <textarea
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              rows={2}
              autoFocus
              className="w-full resize-none rounded-md border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <div className="mt-1 flex justify-end gap-1">
              <button
                onClick={() => setEditing(false)}
                className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-secondary"
              >
                Annuler
              </button>
              <button
                onClick={saveEdit}
                disabled={!editText.trim()}
                className="flex items-center gap-1 rounded bg-primary px-2.5 py-1 text-xs text-primary-foreground disabled:opacity-50"
              >
                <Check size={12} /> Enregistrer
              </button>
            </div>
          </div>
        ) : (
          <div
            className="prose-doc mt-0.5 max-w-none whitespace-pre-wrap text-sm"
            dangerouslySetInnerHTML={{ __html: c.content }}
          />
        )}

        {/* Pièces jointes : 2 vignettes max + tuile « +x images » (lightbox), chips PDF/zip/texte */}
        {Array.isArray(c.attachments) && c.attachments.length > 0 && (
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
              <Reply size={13} /> Répondre
            </button>
          )}
          {canEdit && !editing && (
            <button
              onClick={(e) => {
                stop(e);
                startEdit();
              }}
              title="Éditer"
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              <Pencil size={12} />
            </button>
          )}
          {canDelete &&
            (confirmDelete ? (
              <span onClick={stop} className="flex items-center gap-1 text-[11px]">
                <button
                  onClick={remove}
                  className="rounded bg-destructive px-1.5 py-0.5 text-destructive-foreground"
                >
                  Supprimer
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="rounded px-1.5 py-0.5 text-muted-foreground hover:bg-secondary"
                >
                  Annuler
                </button>
              </span>
            ) : (
              <button
                onClick={(e) => {
                  stop(e);
                  setConfirmDelete(true);
                }}
                title="Supprimer"
                className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-secondary hover:text-destructive"
              >
                <Trash2 size={12} />
              </button>
            ))}
        </div>

        {/* Réponses */}
        {c.replies && c.replies.length > 0 && (
          <div className="mt-2 space-y-1 border-l border-border pl-2">
            {c.replies.map((r) => (
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
                isReply
              />
            ))}
          </div>
        )}

        {replying && (
          <div onClick={stop}>
            <ReplyComposer
              mediaObjectId={mediaObjectId}
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
