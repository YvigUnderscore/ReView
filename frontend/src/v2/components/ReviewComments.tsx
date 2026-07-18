import { Link2 } from 'lucide-react';
import { toast } from 'sonner';
import CommentItem from './comments/CommentItem';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from './ui/context-menu';
import { commentLink } from '../pages/review/deepLink';
import type { ReviewComment } from '../types/api';

/** Fil de commentaires de review (racines + réponses imbriquées, clic droit par carte). */
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
  // Lien profond (32.E) : URL de la review courante ciblant ce commentaire.
  const copyLink = (c: ReviewComment) =>
    void navigator.clipboard
      .writeText(commentLink(window.location.origin, window.location.pathname, c.id))
      .then(() => toast.success('Lien copié'))
      .catch(() => toast.error('Copie impossible'));

  return (
    <div className="space-y-2">
      {comments.length === 0 && (
        <p className="text-sm text-muted-foreground">Aucun commentaire pour l’instant.</p>
      )}
      {comments.map((c) => (
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
              <Link2 size={14} /> Copier le lien au commentaire
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      ))}
    </div>
  );
}
