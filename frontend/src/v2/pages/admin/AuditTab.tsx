// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useQuery } from '@tanstack/react-query';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { SkeletonRows } from '../../components/ui/skeleton';
import type { AuditRow } from './adminShared';
import { useT } from '../../i18n';

export default function AuditTab() {
  const t = useT();
  const { data: audit, isLoading } = useQuery({
    queryKey: qk.admin('audit'),
    queryFn: () => api.get<{ items: AuditRow[] }>('/api/studio/audit').then((d) => d.items),
  });
  if (isLoading) return <SkeletonRows count={6} />;
  return (
    <ul className="space-y-1 text-xs text-muted-foreground">
      {(audit ?? []).map((a) => (
        <li key={a.id}>
          <span className="text-foreground">{a.action}</span> {a.entityType ?? ''} {a.entityId ?? ''} ·{' '}
          {new Date(a.createdAt).toLocaleString()}
        </li>
      ))}
      {(!audit || audit.length === 0) && <li>{t('admin.noEntry')}</li>}
    </ul>
  );
}
