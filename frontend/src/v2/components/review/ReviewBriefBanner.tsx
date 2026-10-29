// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Eye } from 'lucide-react';
import type { ReviewAssignee } from '../../types/entities';
import { useT } from '../../i18n';

/**
 * The brief written FOR YOU, at the top of the review.
 *
 * That is the whole point of the feature: the notification says you are awaited, this banner says on what, at the exact
 * moment you are looking at the media, and not three clicks further on in a dialog one would have to think of opening.
 *
 * It is only shown to the person entrusted, and only if a brief has been written: an assignment without a brief has nothing
 * to announce, and an empty banner would merely take height from the viewer.
 */
export default function ReviewBriefBanner({
  reviewers,
  currentUserId,
}: {
  reviewers: ReviewAssignee[];
  currentUserId: number | undefined;
}) {
  const t = useT();
  const mine = reviewers.find((person) => person.id === currentUserId);
  if (!mine?.note) return null;

  return (
    <div className="mb-2 flex shrink-0 items-start gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2">
      <Eye size={15} className="mt-0.5 shrink-0 text-primary" />
      <p className="min-w-0 text-sm">
        <span className="mr-1.5 text-2xs section-label text-muted-foreground">{t('reviewers.forYou')}</span>
        {/* `whitespace-pre-wrap`: the brief is written in a multi-line field, and a three-point list folded back onto
            a single line reads poorly. */}
        <span className="whitespace-pre-wrap">{mine.note}</span>
      </p>
    </div>
  );
}
