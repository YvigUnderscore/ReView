// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { CheckCheck } from 'lucide-react';
import { Button } from '../ui/button';
import { useMarkAllSeen, type VisitListTarget } from '../../lib/useVisits';
import { useT } from '../../i18n';

/**
 * "Mark all as read": the button that switches off a whole list.
 *
 * The interface aims to be sober and routes every action through right-click; this one is the deliberate exception,
 * since it applies to no card in particular: there is no card on which to right-click. It stays invisible as long as
 * there is nothing to switch off, so it only weighs on screens that actually have news.
 *
 * The count shown is that of the loaded list. The gesture, however, covers the whole project: what remains to be
 * scrolled to is switched off too, otherwise "all" would be a lie.
 */
export default function MarkAllSeenButton({
  target,
  projectId,
  unseenCount,
}: {
  target: VisitListTarget;
  projectId: number;
  unseenCount: number;
}) {
  const t = useT();
  const mark = useMarkAllSeen(target, projectId);
  if (unseenCount === 0) return null;
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={mark.isPending}
      onClick={() => mark.mutate()}
      // The count lives in the tooltip, not in the label: a button whose text changes length on every
      // refresh would make the toolbar jump.
      title={t('cards.markAllSeenHint', { count: unseenCount })}
    >
      <CheckCheck size={14} />
      {t('cards.markAllSeen')}
    </Button>
  );
}
