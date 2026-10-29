// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Link } from 'react-router-dom';
import { Clapperboard, Share2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { reviewPath } from '../../lib/slug';
import { ContextMenuItem } from '../../components/ui/context-menu';
import { shotLabelOf, type MontageComment } from './montageFeedback';
import type { TimelineClip, TimelineView } from '../../types/api';
import { useT } from '../../i18n';

/**
 * Identity of the montage in the chrome header: the film, then the shot on screen (Phase 46).
 *
 * The shot label is permanent: on a single timeline, it is the only thing that continuously says
 * where we are in the film.
 */
export default function MontageHeader({
  name,
  clip,
  timeline,
}: {
  name: string;
  clip: TimelineClip | null;
  timeline: TimelineView;
}) {
  const t = useT();
  return (
    <>
      <Clapperboard size={16} className="shrink-0 text-primary" />
      <h1 className="truncate text-lg font-semibold">{name}</h1>
      <span className="shrink-0 text-xs text-muted-foreground">
        {t('timeline.shotCount', { count: timeline.items.length })}
      </span>
      {clip && (
        <span className="shrink-0 rounded border border-border px-2 py-0.5 text-xs">
          <span className="text-muted-foreground">{clip.sequenceCode ?? '—'}</span> · {clip.shotCode}
          {clip.versionName && <span className="text-muted-foreground"> · {clip.versionName}</span>}
        </span>
      )}
      {clip?.mediaId != null && (
        <Link
          to={reviewPath({ id: clip.mediaId, originalName: clip.mediaName })}
          className="shrink-0 text-xs text-primary hover:underline"
        >
          {t('timeline.openInReview')}
        </Link>
      )}
    </>
  );
}

/**
 * Right-click entry of a montage note: send it back to the shot's review.
 *
 * Nothing is copied — the note already carries its frame within the shot, computed when it was
 * written. It therefore appears there on the exact image, and stays here.
 */
export function ShareToShotItem({
  comment,
  clips,
  onShared,
}: {
  comment: MontageComment;
  clips: TimelineClip[];
  onShared: () => void;
}) {
  const t = useT();
  if (comment.sharedToShot)
    return (
      <ContextMenuItem disabled>
        <Share2 size={14} /> {t('timeline.sharedToShot')}
      </ContextMenuItem>
    );
  return (
    <ContextMenuItem
      onSelect={() =>
        void api
          .post(`/api/comments/${comment.id}/share`, {})
          .then(() => {
            toast.success(t('timeline.shareDone', { shot: shotLabelOf(clips, comment.mediaObjectId) }));
            onShared();
          })
          .catch((e: unknown) => toast.error(e instanceof Error ? e.message : t('common.error.generic')))
      }
    >
      <Share2 size={14} /> {t('timeline.shareToShot')}
    </ContextMenuItem>
  );
}
