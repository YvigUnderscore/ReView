// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { reviewStatusStyle } from './reviewDecision.helpers';
import { useTheme } from '../stores/useTheme';
import { useT } from '../i18n';
import type { ReviewStatus } from '../types/api';

/**
 * Badge de décision de review (Phase 31). La couleur vient du statut configuré
 * par le studio (donnée dynamique → style inline, pas un token de thème).
 */
export default function ReviewDecisionBadge({
  status,
  title,
}: {
  status: Pick<ReviewStatus, 'name' | 'color'>;
  title?: string;
}) {
  const t = useT();
  const theme = useTheme((s) => s.theme);
  return (
    <span
      title={title ?? t('decision.badge', { status: status.name })}
      className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-2xs font-medium"
      style={reviewStatusStyle(status.color, theme === 'dark')}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: status.color }} />
      {status.name}
    </span>
  );
}
