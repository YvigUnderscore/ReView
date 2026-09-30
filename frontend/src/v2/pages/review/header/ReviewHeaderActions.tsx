// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ClipboardCheck,
  ExternalLink,
  Keyboard,
  MonitorPlay,
  PanelRightClose,
  PanelRightOpen,
  PictureInPicture2,
} from 'lucide-react';
import { api } from '../../../../lib/apiClient';
import { qk } from '../../../lib/query';
import Avatar from '../../../components/Avatar';
import ShortcutsHelp from '../../../components/ShortcutsHelp';
import ReviewDecisionBadge from '../../../components/ReviewDecisionBadge';
import ReviewDecisionDialog from '../../../components/ReviewDecisionDialog';
import ReviewersDialog from '../../../components/review/ReviewersDialog';
import { useSgLinks } from '../../../components/shotgrid/useSgLinks';
import { useAuth } from '../../../stores/useAuth';
import type { VersionDetail } from '../../../types/api';
import type { MediaResp } from '../reviewTypes';
import CompareSelect from '../CompareSelect';
import LiveControl from '../LiveControl';
import { useReviewPresence } from '../useReviewPresence';
import type { LiveSession } from '../useLiveSession';
import { headerActions, type HeaderActionId } from './headerComposition';
import { useT } from '../../../i18n';

/** Bouton d'action de l'en-tête — même cadre pour tous, seule l'icône change. */
const ACTION_BTN =
  'rounded-md border border-border p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground';

/**
 * Coin droit de l'en-tête fusionné : ce qu'on fait du média. Sélecteur A/B (vidéo et image
 * seulement — la 3D et le splat montent le leur), fiche ShotGrid, salle live, présence,
 * publication, décision de review, lecteur détachable, théâtre, raccourcis, repli des
 * commentaires.
 *
 * La composition vient de `headerActions` : une seule liste décide de ce qui existe selon le
 * type de média et l'état du média, et elle est vérifiable hors rendu.
 */
export default function ReviewHeaderActions({
  data,
  onPublish,
  commentsOpen,
  onToggleComments,
  compareIds,
  onAddCompare,
  onRemoveCompare,
  onCompareChange,
  onToggleTheater,
  onPictureInPicture,
  live,
}: {
  data: MediaResp;
  onPublish: (reviewers?: { userId: number; note: string | null }[]) => void | Promise<void>;
  commentsOpen: boolean;
  onToggleComments: () => void;
  /** Mode théâtre immersif in-window (42.A — №76). */
  onToggleTheater: () => void;
  /** Lecteur détachable Picture-in-Picture (42.A — №75), vidéo uniquement. */
  onPictureInPicture?: () => void;
  /** Médias B cochés (34.D) : 1 = A/B ; 2-3 = grille 2×2 (vidéo). */
  compareIds: number[];
  onAddCompare: (mediaId: number) => void;
  onRemoveCompare: (mediaId: number) => void;
  /** Remplacement exclusif (image / live). */
  onCompareChange: (mediaId: number | null) => void;
  live: LiveSession;
}) {
  const t = useT();
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [decisionOpen, setDecisionOpen] = useState(false);
  // Publier passe par le dialogue : c'est le moment où l'on dit à qui l'on livre, et quoi
  // regarder. Le serveur écrit la liste avant de basculer le média, ce qui permet au
  // réglage « consigne obligatoire » de refuser la publication plutôt que de râler après.
  const [publishOpen, setPublishOpen] = useState(false);
  const viewers = useReviewPresence(data.media.id);
  const role = useAuth((s) => s.user?.role);
  const canDecide = role === 'ADMIN' || role === 'SUPERVISOR';
  const versionId = data.media.versionId;
  const kind = data.media.kind;
  // Correspondances ShotGrid du projet : sans connexion, rien n'est demandé ni affiché.
  const sgLinks = useSgLinks(data.projectId);
  const sgUrl = sgLinks.linkFor('version', versionId);
  // Décision courante de la version (badge en-tête) — même clé que la timeline des versions.
  const versionQ = useQuery({
    queryKey: qk.version(versionId),
    queryFn: () => api.get<{ version: VersionDetail }>(`/api/versions/${versionId}`).then((d) => d.version),
    staleTime: 30_000,
  });
  const reviewStatus = versionQ.data?.reviewStatus ?? null;

  const actions = headerActions({
    kind,
    published: data.media.published,
    hasSgLink: !!sgUrl,
    hasViewers: viewers.length > 0,
    canPictureInPicture: !!onPictureInPicture,
  });
  const has = (id: HeaderActionId) => actions.includes(id);

  return (
    <>
      {has('compare') && (
        <CompareSelect
          versionId={versionId}
          mediaId={data.media.id}
          kind={kind}
          compareIds={compareIds}
          onAdd={onAddCompare}
          onRemove={onRemoveCompare}
          onSet={onCompareChange}
        />
      )}
      {has('shotgrid') && sgUrl && (
        <a
          href={sgUrl}
          target="_blank"
          rel="noreferrer"
          title={t('shotgrid.openIn.version')}
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          <ExternalLink size={15} />
        </a>
      )}
      <LiveControl live={live} projectId={data.projectId} />
      {has('presence') && (
        <div
          className="flex items-center -space-x-2"
          title={t('presence.watching', { names: viewers.map((v) => v.displayName).join(', ') })}
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
      {has('publish') && (
        <button
          onClick={() => setPublishOpen(true)}
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
        >
          {t('review.publish')}
        </button>
      )}
      <button
        onClick={() => setDecisionOpen(true)}
        title={canDecide ? t('decision.title') : t('header.decisionHistory')}
        className={`flex items-center gap-1.5 ${ACTION_BTN}`}
      >
        <ClipboardCheck size={16} />
        {reviewStatus && <ReviewDecisionBadge status={reviewStatus} />}
      </button>
      {has('pip') && onPictureInPicture && (
        <button onClick={onPictureInPicture} title={t('review.pip')} className={ACTION_BTN}>
          <PictureInPicture2 size={16} />
        </button>
      )}
      <button onClick={onToggleTheater} title={t('review.theatre')} className={ACTION_BTN}>
        <MonitorPlay size={16} />
      </button>
      <button onClick={() => setShortcutsOpen(true)} title={t('shortcuts.openTitle')} className={ACTION_BTN}>
        <Keyboard size={16} />
      </button>
      <button
        onClick={onToggleComments}
        title={commentsOpen ? t('header.hideComments') : t('header.showComments')}
        className={ACTION_BTN}
      >
        {commentsOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
      </button>
      <ShortcutsHelp open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      {publishOpen && (
        <ReviewersDialog
          open
          onOpenChange={setPublishOpen}
          projectId={data.projectId}
          reviewers={data.reviewers}
          rule={data.reviewRequest}
          title={t('reviewers.publishTitle')}
          description={t('reviewers.publishHint')}
          submitLabel={t('review.publish')}
          onSubmit={async (reviewers) => {
            await onPublish(reviewers);
            setPublishOpen(false);
          }}
        />
      )}
      <ReviewDecisionDialog
        versionId={versionId}
        versionName={versionQ.data?.name ?? `Version ${versionId}`}
        open={decisionOpen}
        onOpenChange={setDecisionOpen}
        canDecide={canDecide}
        projectId={data.projectId}
      />
    </>
  );
}
