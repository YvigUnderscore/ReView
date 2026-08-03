// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ClipboardCheck,
  Keyboard,
  MonitorPlay,
  PanelRightClose,
  PanelRightOpen,
  PictureInPicture2,
} from 'lucide-react';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import Avatar from '../../components/Avatar';
import ShortcutsHelp from '../../components/ShortcutsHelp';
import ReviewDecisionBadge from '../../components/ReviewDecisionBadge';
import ReviewDecisionDialog from '../../components/ReviewDecisionDialog';
import { useAuth } from '../../stores/useAuth';
import type { MediaResp } from './reviewTypes';
import type { VersionDetail } from '../../types/api';
import VersionNavigator from './VersionNavigator';
import PlaylistNavigator from './PlaylistNavigator';
import CompareSelect from './CompareSelect';
import LiveControl from './LiveControl';
import { useReviewPresence } from './useReviewPresence';
import type { LiveSession } from './useLiveSession';
import { useT } from '../../i18n';

/**
 * En-tête de la review : nom du média + badge brouillon, sélecteur de version
 * et précédent/suivant entre médias (10.C2), publication, décision de review
 * (Phase 31), repli des commentaires.
 */
export default function ReviewHeader({
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
  onPublish: () => void;
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
  const published = data.media.published;
  const viewers = useReviewPresence(data.media.id);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [decisionOpen, setDecisionOpen] = useState(false);
  const role = useAuth((s) => s.user?.role);
  const canDecide = role === 'ADMIN' || role === 'SUPERVISOR';
  const versionId = data.media.versionId;
  // Décision courante de la version (badge en-tête) — même clé que la timeline des versions.
  const versionQ = useQuery({
    queryKey: qk.version(versionId),
    queryFn: () => api.get<{ version: VersionDetail }>(`/api/versions/${versionId}`).then((d) => d.version),
    staleTime: 30_000,
  });
  const reviewStatus = versionQ.data?.reviewStatus ?? null;
  return (
    <div className="mb-3 flex shrink-0 items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <h1 className="truncate text-lg font-semibold">{data.media.originalName}</h1>
        {!published && (
          <span className="shrink-0 rounded bg-primary/15 px-2 py-0.5 text-xs text-primary">
            {t('reviews.draft')}
          </span>
        )}
        <VersionNavigator versionId={versionId} mediaId={data.media.id} />
        <PlaylistNavigator versionId={versionId} />
        {(data.media.kind === 'VIDEO' || data.media.kind === 'IMAGE') && (
          <CompareSelect
            versionId={versionId}
            mediaId={data.media.id}
            kind={data.media.kind}
            compareIds={compareIds}
            onAdd={onAddCompare}
            onRemove={onRemoveCompare}
            onSet={onCompareChange}
          />
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2 text-sm">
        <LiveControl live={live} projectId={data.projectId} />
        {viewers.length > 0 && (
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
        {!published && (
          <button
            onClick={onPublish}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
          >
            {t('review.publish')}
          </button>
        )}
        <button
          onClick={() => setDecisionOpen(true)}
          title={canDecide ? t('decision.title') : t('header.decisionHistory')}
          className="flex items-center gap-1.5 rounded-md border border-border p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          <ClipboardCheck size={16} />
          {reviewStatus && <ReviewDecisionBadge status={reviewStatus} />}
        </button>
        {data.media.kind === 'VIDEO' && onPictureInPicture && (
          <button
            onClick={onPictureInPicture}
            title={t('review.pip')}
            className="rounded-md border border-border p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <PictureInPicture2 size={16} />
          </button>
        )}
        <button
          onClick={onToggleTheater}
          title={t('review.theatre')}
          className="rounded-md border border-border p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          <MonitorPlay size={16} />
        </button>
        <button
          onClick={() => setShortcutsOpen(true)}
          title={t('shortcuts.openTitle')}
          className="rounded-md border border-border p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          <Keyboard size={16} />
        </button>
        <button
          onClick={onToggleComments}
          title={commentsOpen ? t('header.hideComments') : t('header.showComments')}
          className="rounded-md border border-border p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          {commentsOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
        </button>
      </div>
      <ShortcutsHelp open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      <ReviewDecisionDialog
        versionId={versionId}
        versionName={versionQ.data?.name ?? `Version ${versionId}`}
        open={decisionOpen}
        onOpenChange={setDecisionOpen}
        canDecide={canDecide}
      />
    </div>
  );
}
