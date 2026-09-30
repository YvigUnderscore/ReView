// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useQuery } from '@tanstack/react-query';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { useT } from '../../i18n';
import type { MediaRef } from '../../types/api';
import type { BoardScope } from './boardApi';

/**
 * Bibliothèque d'images publiées du projet, insérables dans le board d'un clic.
 * Le projectId d'un board d'asset se résout via l'asset.
 */
export type MediaLite = MediaRef & { thumbnailUrl: string | null; url: string };

export default function BoardLibrary({
  scope,
  targetId,
  onInsert,
}: {
  scope: BoardScope;
  targetId: number;
  onInsert: (media: MediaLite) => void;
}) {
  const t = useT();
  const assetQ = useQuery({
    queryKey: qk.asset(targetId),
    queryFn: () => api.get<{ asset: { projectId: number } }>(`/api/assets/${targetId}`),
    enabled: scope === 'asset',
  });
  const projectId = scope === 'project' ? targetId : assetQ.data?.asset.projectId;
  const libraryQ = useQuery({
    queryKey: qk.projectMedia(projectId ?? 0, 'IMAGE'),
    queryFn: () =>
      api.get<{ items: MediaLite[] }>(`/api/media?projectId=${projectId}&kind=IMAGE`).then((d) => d.items),
    enabled: projectId != null,
  });
  const library = libraryQ.data ?? [];

  return (
    <div
      className="custom-scrollbar w-44 shrink-0 space-y-2 overflow-auto rounded-lg border border-border bg-card p-2"
      style={{ height: '78vh' }}
    >
      <div className="text-xs font-medium text-muted-foreground">{t('board.publishedImages')}</div>
      {library.map((m) => (
        <button
          key={m.id}
          onClick={() => onInsert(m)}
          title={t('board.insert', { name: m.originalName })}
          className="block w-full overflow-hidden rounded border border-border hover:border-primary"
        >
          {m.thumbnailUrl ? (
            <img src={m.thumbnailUrl} alt={m.originalName} className="h-20 w-full object-cover" />
          ) : (
            <div className="flex h-20 items-center justify-center text-2xs text-muted-foreground">
              {m.originalName}
            </div>
          )}
        </button>
      ))}
      {library.length === 0 && <p className="text-xs text-muted-foreground">{t('board.noPublishedImage')}</p>}
    </div>
  );
}
