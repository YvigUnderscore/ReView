import { PanelRightClose, PanelRightOpen } from 'lucide-react';
import type { MediaResp } from './reviewTypes';
import VersionNavigator from './VersionNavigator';

/**
 * En-tête de la review : nom du média + badge brouillon, sélecteur de version
 * et précédent/suivant entre médias (10.C2), publication, repli des commentaires.
 */
export default function ReviewHeader({ data, onPublish, commentsOpen, onToggleComments }: {
  data: MediaResp;
  onPublish: () => void;
  commentsOpen: boolean;
  onToggleComments: () => void;
}) {
  const published = data.media.published;
  return (
    <div className="mb-3 flex shrink-0 items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <h1 className="truncate text-lg font-semibold">{data.media.originalName}</h1>
        {!published && (
          <span className="shrink-0 rounded bg-primary/15 px-2 py-0.5 text-xs text-primary">Brouillon</span>
        )}
        <VersionNavigator versionId={data.media.versionId} mediaId={data.media.id} />
      </div>
      <div className="flex shrink-0 items-center gap-2 text-sm">
        {!published && (
          <button onClick={onPublish} className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground">Publier pour l’équipe</button>
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
