// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { Button } from '../../components/ui/button';
import Avatar from '../../components/Avatar';
import { SkeletonRows } from '../../components/ui/skeleton';
import { timeAgo } from '../../lib/time';
import { auditActionLabel, auditEntityLink, type AuditRow } from './adminShared';
import { useT } from '../../i18n';

interface Page {
  items: AuditRow[];
  total: number;
  page: number;
  pageSize: number;
}

/** Flux d'activité : journal d'audit paginé, avec auteur (avatar) et liens navigables. */
export default function ActivityTab() {
  const t = useT();
  const [page, setPage] = useState(1);
  const { data, isLoading } = useQuery({
    queryKey: qk.admin(`activity-feed-${page}`),
    queryFn: () => api.get<Page>(`/api/studio/audit?page=${page}&pageSize=30`),
    placeholderData: keepPreviousData,
  });

  if (isLoading && !data) return <SkeletonRows count={8} />;
  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const pageSize = data?.pageSize ?? 30;
  const maxPage = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div>
      <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
        {items.map((a) => {
          const link = auditEntityLink(a.entityType, a.entityId);
          const label = auditActionLabel(a.action);
          return (
            <li key={a.id} className="flex items-center gap-3 bg-card px-3 py-2 text-sm">
              <Avatar
                seed={a.user?.id ?? 0}
                initials={a.user?.initials ?? '?'}
                avatarUrl={a.user?.avatarUrl}
                size={28}
              />
              <div className="min-w-0 flex-1">
                <span className="font-medium">{a.user?.displayName ?? t('admin.tab.system')}</span>{' '}
                <span className="text-muted-foreground">{label}</span>{' '}
                {a.entityType &&
                  a.entityId != null &&
                  (link ? (
                    <Link to={link} className="text-primary hover:underline">
                      {a.entityType} #{a.entityId}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">
                      {a.entityType} #{a.entityId}
                    </span>
                  ))}
              </div>
              <time
                className="shrink-0 text-xs text-muted-foreground"
                title={new Date(a.createdAt).toLocaleString()}
              >
                {timeAgo(a.createdAt)}
              </time>
            </li>
          );
        })}
        {items.length === 0 && (
          <li className="bg-card px-3 py-6 text-center text-sm text-muted-foreground">
            {t('admin.noActivity')}
          </li>
        )}
      </ul>

      {maxPage > 1 && (
        <div className="mt-3 flex items-center justify-center gap-3 text-sm">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            {t('common.previous')}
          </Button>
          <span className="text-muted-foreground">
            Page {page} / {maxPage}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= maxPage}
            onClick={() => setPage((p) => p + 1)}
          >
            {t('common.next')}
          </Button>
        </div>
      )}
    </div>
  );
}
