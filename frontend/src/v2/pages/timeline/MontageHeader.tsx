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
 * Identité du montage dans l'en-tête du chrome : le film, puis le plan à l'écran (Phase 46).
 *
 * Le libellé du plan est permanent : sur une seule timeline, c'est la seule chose qui dit
 * en continu où l'on se trouve dans le film.
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
 * Entrée de clic droit d'un retour de montage : le renvoyer sur la review du plan.
 *
 * Rien n'est recopié — le retour porte déjà sa frame dans le plan, calculée à l'écriture.
 * Il apparaît donc là-bas sur l'image exacte, et reste ici.
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
