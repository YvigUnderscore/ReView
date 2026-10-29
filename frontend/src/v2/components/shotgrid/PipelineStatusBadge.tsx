// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { usePipelineStatuses } from '../../lib/shotgridApi';
import type { StatusScope } from '../../types/shotgrid';
import { statusSwatch } from '../../lib/contrast';
import { useTheme } from '../../stores/useTheme';

/**
 * Pipeline status badge.
 *
 * The colour comes from the reference data (that of the ShotGrid site when it provides one), not from a frozen table: that is
 * the whole point of having made the statuses editable. With no status set, the component renders nothing rather than a
 * decorative empty space.
 *
 * The site's tint is taken as is for the background, but the text goes through `statusSwatch` (A2): a dark `bg_color` coming
 * from ShotGrid was unreadable on the midnight theme, and a pale yellow was unreadable on the light theme.
 */
export default function PipelineStatusBadge({
  statusId,
  scope,
  size = 'sm',
}: {
  statusId: number | null | undefined;
  scope: StatusScope;
  size?: 'sm' | 'xs';
}) {
  const { data: statuses = [] } = usePipelineStatuses(scope);
  const theme = useTheme((s) => s.theme);
  if (!statusId) return null;
  const status = statuses.find((s) => s.id === statusId);
  if (!status) return null;
  const swatch = statusSwatch(status.color, theme === 'dark');

  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded px-1.5 ${
        size === 'xs' ? 'text-2xs' : 'py-0.5 text-xs'
      } ${swatch ? '' : 'bg-secondary text-muted-foreground'}`}
      style={swatch ? { backgroundColor: swatch.backgroundColor, color: swatch.color } : undefined}
      title={status.code}
    >
      <span
        className={`inline-block h-1.5 w-1.5 rounded-full ${swatch ? '' : 'bg-muted-foreground'}`}
        style={swatch ? { backgroundColor: status.color } : undefined}
      />
      {status.name}
    </span>
  );
}
