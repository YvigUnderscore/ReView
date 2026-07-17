import { PanelRightClose, PanelRightOpen } from 'lucide-react';
import Avatar from '../../components/Avatar';
import type { MediaResp } from './reviewTypes';
import VersionNavigator from './VersionNavigator';
import CompareSelect from './CompareSelect';
import { useReviewPresence } from './useReviewPresence';

/**
 * En-tête de la review : nom du média + badge brouillon, sélecteur de version
 * et précédent/suivant entre médias (10.C2), publication, repli des commentaires.
 */
export default function ReviewHeader({
  data,
  onPublish,
  commentsOpen,
  onToggleComments,
  compareId,
  onCompareChange,
}: {
  data: MediaResp;
  onPublish: () => void;
  commentsOpen: boolean;
  onToggleComments: () => void;
  compareId: number | null;
  onCompareChange: (mediaId: number | null) => void;
}) {
  const published = data.media.published;
  const viewers = useReviewPresence(data.media.id);
  return (
    <div className="mb-3 flex shrink-0 items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <h1 className="truncate text-lg font-semibold">{data.media.originalName}</h1>
        {!published && (
          <span className="shrink-0 rounded bg-primary/15 px-2 py-0.5 text-xs text-primary">Brouillon</span>
        )}
        <VersionNavigator versionId={data.media.versionId} mediaId={data.media.id} />
        {(data.media.kind === 'VIDEO' || data.media.kind === 'IMAGE') && (
          <CompareSelect
            versionId={data.media.versionId}
            mediaId={data.media.id}
            kind={data.media.kind}
            compareId={compareId}
            onCompareChange={onCompareChange}
          />
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2 text-sm">
        {viewers.length > 0 && (
          <div
            className="flex items-center -space-x-2"
            title={`En train de regarder : ${viewers.map((v) => v.displayName).join(', ')}`}
          >
            {viewers.slice(0, 5).map((v) => (
              <span key={v.id} className="rounded-full ring-2 ring-background">
                <Avatar seed={v.id} initials={v.initials} avatarUrl={v.avatarUrl} size={24} />
              </span>
            ))}
            {viewers.length > 5 && (
              <span className="pl-3 text-xs text-muted-foreground">+{viewers.length - 5}</span>
            )}
          </div>
        )}
        {!published && (
          <button
            onClick={onPublish}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
          >
            Publier pour l’équipe
          </button>
        )}
        <button
          onClick={onToggleComments}
          title={commentsOpen ? 'Masquer les commentaires' : 'Afficher les commentaires'}
          className="rounded-md border border-border p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          {commentsOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
        </button>
      </div>
    </div>
  );
}
