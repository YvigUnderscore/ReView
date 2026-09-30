// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Badge } from '../../components/ui/badge';
import { useT, type MessageKey } from '../../i18n';

/** Traducteur passé aux tables de libellés, recalculées à chaque rendu. */
type Tr = (key: MessageKey) => string;

const statusLabel = (t: Tr): Record<string, string> => ({
  ACTIVE: t('project.status.active'),
  ON_HOLD: t('project.status.onHold'),
  COMPLETED: t('project.status.completed'),
  ARCHIVED: t('project.status.archived'),
});

/** Pastille de statut d'un projet (couleur dérivée du statut). */
export default function ProjectStatusBadge({ status }: { status: string }) {
  const t = useT();
  const variant =
    status === 'ACTIVE'
      ? 'success'
      : status === 'ON_HOLD'
        ? 'warning'
        : status === 'COMPLETED'
          ? 'info'
          : ('muted' as const);
  return <Badge variant={variant}>{statusLabel(t)[status] ?? status}</Badge>;
}
