// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Eye, Link2, User as UserIcon } from 'lucide-react';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { Button } from '../../components/ui/button';
import { SkeletonRows } from '../../components/ui/skeleton';
import { useT } from '../../i18n';
import { intlLocale } from '../../i18n';

interface AccessRow {
  id: number;
  createdAt: string;
  ip: string | null;
  shareLinkId: number | null;
  shareLabel: string | null;
  media: { id: number; originalName: string; kind: string };
  user: { id: number; name: string | null; email: string } | null;
}

interface AccessPage {
  items: AccessRow[];
  total: number;
  page: number;
  pageSize: number;
}

const fmt = (iso: string) =>
  new Date(iso).toLocaleString(intlLocale(), {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

/** Journal d'accès aux médias (36.E) : qui a visionné quoi / quand — comptes et partages. */
export default function MediaAccessTab() {
  const t = useT();
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const logQ = useQuery({
    queryKey: [...qk.admin('media-access'), page],
    queryFn: () => api.get<AccessPage>(`/api/admin/media-access?page=${page}&pageSize=${pageSize}`),
  });
  if (!logQ.data) return <SkeletonRows count={6} />;
  const { items, total } = logQ.data;
  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="max-w-3xl">
      <p className="mb-3 text-xs text-muted-foreground">
        Une ligne par consultation (dédupliquée sur 30 minutes) — reviews internes et partages clients
        confondus. {total} accès au total.
      </p>
      <div className="space-y-1">
        {items.map((r) => (
          <div
            key={r.id}
            className="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-1.5 text-sm"
          >
            <Eye size={14} className="shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">
              <span className="font-medium">{r.media.originalName}</span>
              <span className="text-xs text-muted-foreground"> · {r.media.kind}</span>
            </span>
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {r.user ? (
                <>
                  <UserIcon size={12} /> {r.user.name ?? r.user.email}
                </>
              ) : (
                <>
                  <Link2 size={12} /> {r.shareLabel ?? 'Partage client'}
                </>
              )}
            </span>
            <span className="w-28 text-right text-xs text-muted-foreground">{fmt(r.createdAt)}</span>
          </div>
        ))}
        {items.length === 0 && (
          <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            {t('mediaAccess.empty')}
          </p>
        )}
      </div>
      {pages > 1 && (
        <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            {t('common.previous')}
          </Button>
          <span>
            Page {page} / {pages}
          </span>
          <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
            {t('common.next')}
          </Button>
        </div>
      )}
    </div>
  );
}
