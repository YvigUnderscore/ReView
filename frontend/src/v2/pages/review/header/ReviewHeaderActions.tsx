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
import { api } from '@/lib/apiClient';
import { qk } from '@/v2/lib/query';
import Avatar from '@/v2/components/Avatar';
import ShortcutsHelp from '@/v2/components/ShortcutsHelp';
import ReviewDecisionBadge from '@/v2/components/ReviewDecisionBadge';
import ReviewDecisionDialog from '@/v2/components/ReviewDecisionDialog';
import ReviewersDialog from '@/v2/components/review/ReviewersDialog';
import { useSgLinks } from '@/v2/components/shotgrid/useSgLinks';
import { useAuth } from '@/v2/stores/useAuth';
import type { VersionDetail } from '@/v2/types/api';
import type { MediaResp } from '../reviewTypes';
import CompareSelect from '../CompareSelect';
import LiveControl from '../LiveControl';
import { useReviewPresence } from '../useReviewPresence';
import type { LiveSession } from '../useLiveSession';
import { headerActions, type HeaderActionId } from './headerComposition';
import { useT } from '@/v2/i18n';

/** Header action button: same frame for all, only the icon changes. */
const ACTION_BTN =
  'rounded-md border border-border p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground';

/**
 * Right corner of the merged header: what is done with the media. A/B selector (video and image
 * only: 3D and splat mount their own), ShotGrid sheet, live room, presence, publication, review
 * decision, detachable player, theatre mode, shortcuts, collapsing of the comments.
 *
 * The composition comes from `headerActions`: a single list decides what exists depending on the
 * media type and the state of the media, and it can be verified outside rendering.
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
  /** Immersive theatre mode within the window (42.A — №76). */
  onToggleTheater: () => void;
  /** Detachable Picture-in-Picture player (42.A — №75), video only. */
  onPictureInPicture?: () => void;
  /** Ticked B media (34.D): 1 = A/B; 2-3 = 2×2 grid (video). */
  compareIds: number[];
  onAddCompare: (mediaId: number) => void;
  onRemoveCompare: (mediaId: number) => void;
  /** Exclusive replacement (image / live). */
  onCompareChange: (mediaId: number | null) => void;
  live: LiveSession;
}) {
  const t = useT();
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [decisionOpen, setDecisionOpen] = useState(false);
  // Publishing goes through the dialog: it is the moment you say to whom you deliver, and what to
  // watch. The server writes the list before switching the media, which lets the "mandatory note"
  // setting refuse the publication rather than complain afterwards.
  const [publishOpen, setPublishOpen] = useState(false);
  const viewers = useReviewPresence(data.media.id);
  const role = useAuth((s) => s.user?.role);
  const canDecide = role === 'ADMIN' || role === 'SUPERVISOR';
  const versionId = data.media.versionId;
  const kind = data.media.kind;
  // The project's ShotGrid mappings: without a connection, nothing is requested or displayed.
  const sgLinks = useSgLinks(data.projectId);
  const sgUrl = sgLinks.linkFor('version', versionId);
  // Current decision of the version (header badge): same key as the version timeline.
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
