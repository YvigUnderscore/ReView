// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Eye } from 'lucide-react';
import AssigneeStack from './AssigneeStack';
import { timeAgo } from '../../lib/time';
import DepartmentChips from './DepartmentChips';
import type { AssigneeRef, DepartmentRef } from '../../types/entities';
import { useT } from '../../i18n';
import { intlLocale } from '../../i18n';

/**
 * What a card says about an entity beyond its name.
 *
 * A card used to announce only "twelve tasks". Yet when scanning a grid of two hundred shots, one wants to
 * answer four questions, always the same: what it is (the description), who works on it (the faces), whether
 * there is something to look at (the waiting dot), and since when it has not moved (the date).
 *
 * The reading order is deliberate and the same in both views: the text first, the people next, urgency and
 * time at the end of the line, where the eye returns. Only two levels, the name and then this strip, so the
 * card stays readable at a glance.
 */

export interface EntityMeta {
  description?: string | null;
  assignees?: AssigneeRef[];
  /** Steps the entity goes through, until now declared nowhere visible. */
  departments?: DepartmentRef[];
  /** Published deliveries that no review decision has settled. */
  awaitingReview?: number;
  updatedAt?: string;
  /** Changed since my last visit (batch 9): the card lights up and the date is underlined. */
  unseen?: boolean;
}

/** The "waiting for review" dot: the only coloured information on the strip. */
function AwaitingBadge({ count }: { count: number }) {
  const t = useT();
  return (
    <span
      title={t('cards.awaitingReview', { count })}
      className="flex shrink-0 items-center gap-1 rounded-full bg-warning/15 px-1.5 py-0.5 text-2xs font-medium text-warning"
    >
      <Eye size={11} />
      {count}
    </span>
  );
}

/**
 * "New here": the dot that goes with the card's glow.
 *
 * The glow alone does not say what it means, and a coloured border is not visible when looking closely at a
 * card. The dot carries the tooltip that explains it and gives the colour a named anchor point. It sits to the
 * left of the date, because the date answers "since when".
 */
function UnseenDot() {
  const t = useT();
  return (
    <span
      title={t('cards.unseen')}
      aria-label={t('cards.unseen')}
      // The ring makes the glow: a six-pixel dot is not visible on its own in a strip that
      // already carries faces and a dot.
      className="h-1.5 w-1.5 shrink-0 rounded-full bg-info ring-2 ring-info/30"
    />
  );
}

/** The description, on two lines at most: beyond that, it is no longer a preview. */
export function MetaDescription({ text }: { text: string }) {
  return <p className="line-clamp-2 text-2xs leading-snug text-muted-foreground">{text}</p>;
}

/**
 * The bottom strip of a card: faces on the left, waiting and date on the right.
 *
 * It is only shown when it has something to say: an empty strip on a new card would add height for nothing,
 * and the grid would lose its density.
 */
export default function EntityCardMeta({ meta, compact }: { meta: EntityMeta; compact?: boolean }) {
  const t = useT();
  const people = meta.assignees ?? [];
  const awaiting = meta.awaitingReview ?? 0;
  const departments = meta.departments ?? [];
  // The "unseen" dot alone justifies the strip: a new card where nothing else is filled in must still be
  // able to say that it is new.
  if (people.length === 0 && awaiting === 0 && !meta.updatedAt && departments.length === 0 && !meta.unseen)
    return null;

  return (
    <div className={`flex items-center gap-2 ${compact ? '' : 'mt-2'}`}>
      <AssigneeStack people={people} size={compact ? 20 : 22} max={compact ? 3 : 4} />
      {/* Steps in compact mode rarely fit: the row IS the card. */}
      {!compact && <DepartmentChips departments={departments} />}
      <span className="ml-auto flex shrink-0 items-center gap-1.5">
        {awaiting > 0 && <AwaitingBadge count={awaiting} />}
        {meta.unseen && <UnseenDot />}
        {meta.updatedAt && (
          <span
            title={t('cards.updatedAt', { value: new Date(meta.updatedAt).toLocaleString(intlLocale()) })}
            // The date turns full colour when it is new: it is the figure one reads to know how old
            // the news is, so it should be as visible as possible.
            className={`text-2xs tabular-nums ${
              meta.unseen ? 'font-medium text-info' : 'text-muted-foreground'
            }`}
          >
            {timeAgo(meta.updatedAt)}
          </span>
        )}
      </span>
    </div>
  );
}
