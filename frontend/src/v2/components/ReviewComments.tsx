import CommentItem from './comments/CommentItem';
import type { ReviewComment } from '../types/api';

/** Fil de commentaires de review (racines + réponses imbriquées). */
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
}) {
  return (
    <div className="space-y-2">
      {comments.length === 0 && (
        <p className="text-sm text-muted-foreground">Aucun commentaire pour l’instant.</p>
      )}
      {comments.map((c) => (
        <CommentItem
          key={c.id}
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
      ))}
    </div>
  );
}
