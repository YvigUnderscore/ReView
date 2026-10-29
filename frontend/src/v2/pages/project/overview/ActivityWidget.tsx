// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Link } from 'react-router-dom';
import { FileVideo, Layers } from 'lucide-react';
import { useProjectActivity } from './useProjectActivity';
import { intlLocale, useT } from '@/v2/i18n';

/**
 * The project's latest updates: uploaded versions and published media.
 *
 * `limit` is what the card can show: the height set, translated into rows. A tall card therefore
 * really shows more items. Without this, enlarging it would only have added empty space.
 */
export default function ActivityWidget({ projectId, limit }: { projectId: number; limit: number }) {
  const t = useT();
  const { recent, error } = useProjectActivity(projectId);

  if (error) return <p className="text-xs text-destructive">{error.message}</p>;
  if (recent.length === 0) return <p className="text-xs text-muted-foreground">{t('activity.empty')}</p>;

  return (
    <ul className="space-y-1.5">
      {recent.slice(0, limit).map((item) => {
        const to =
          item.type === 'media' ? `/review/${item.mediaId}` : item.taskId ? `/tasks/${item.taskId}` : '#';
        return (
          <li key={`${item.type}-${item.id}`}>
            <Link
              to={to}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-secondary/60"
            >
              {item.type === 'media' ? (
                <FileVideo size={14} className="shrink-0 text-primary" />
              ) : (
                <Layers size={14} className="shrink-0 text-muted-foreground" />
              )}
              <span className="min-w-0 flex-1 truncate">
                {item.location && <span className="text-muted-foreground">{item.location} · </span>}
                <span className="font-medium">{item.label}</span>
              </span>
              <span className="shrink-0 text-2xs text-muted-foreground">
                {new Date(item.at).toLocaleDateString(intlLocale())}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
