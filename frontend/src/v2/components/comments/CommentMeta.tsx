// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Camera, Film, PenLine } from 'lucide-react';
import { STATE_DOT_CLASS, STATE_LABEL_KEY, type CommentState } from './commentState';
import type { ReviewComment } from '../../types/api';
import { intlLocale, useT } from '../../i18n';

/**
 * Header line of a comment: author, date, status, and the markers of what the card can
 * restore (frame, point of view, annotation). Extracted from `CommentItem` in D1, when the
 * state overflowed the line budget.
 */
export default function CommentMeta({
  comment: c,
  state,
  fps,
  startFrame,
}: {
  comment: ReviewComment;
  state: CommentState;
  fps: number;
  startFrame: number;
}) {
  const t = useT();
  const hasAnnotation = Array.isArray(c.annotation) && c.annotation.length > 0;

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
      <span className="text-sm font-medium">
        {c.author?.displayName ?? c.author?.name ?? c.guestName ?? t('comments.anonymous')}
      </span>
      <span className="text-2xs text-muted-foreground">
        {new Date(c.createdAt).toLocaleString(intlLocale())}
      </span>
      {c.isEdited && <span className="text-2xs italic text-muted-foreground">{t('common.modified')}</span>}
      {state !== 'OPEN' && (
        <span
          title={
            c.resolvedBy
              ? t('comment.resolvedBy', {
                  name: c.resolvedBy.displayName ?? c.resolvedBy.name ?? '?',
                  date: c.resolvedAt ? new Date(c.resolvedAt).toLocaleString(intlLocale()) : '',
                })
              : t(STATE_LABEL_KEY[state])
          }
          className="inline-flex items-center gap-1 rounded bg-secondary px-1.5 py-0.5 text-xs"
        >
          <span className={`h-1.5 w-1.5 rounded-full ${STATE_DOT_CLASS[state]}`} />
          {t(STATE_LABEL_KEY[state])}
        </span>
      )}
      {/* Indicator badges: the whole card is clickable to restore everything. */}
      {c.timestamp != null && (
        <span className="inline-flex items-center gap-1 rounded bg-primary/15 px-1.5 py-0.5 font-mono text-xs text-primary">
          <Film size={10} /> F{startFrame + Math.round(c.timestamp * fps)}
        </span>
      )}
      {c.cameraState != null && (
        <span
          title={t('review.cameraViewSaved')}
          className="inline-flex items-center rounded bg-secondary px-1.5 py-0.5 text-xs text-muted-foreground"
        >
          <Camera size={11} />
        </span>
      )}
      {hasAnnotation && (
        <span
          title={t('comment.annotationAttached')}
          className="inline-flex items-center rounded bg-secondary px-1.5 py-0.5 text-xs text-muted-foreground"
        >
          <PenLine size={11} />
        </span>
      )}
    </div>
  );
}
