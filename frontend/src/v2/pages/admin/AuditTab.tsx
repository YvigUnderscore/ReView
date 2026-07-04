import { useQuery } from '@tanstack/react-query';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { SkeletonRows } from '../../components/ui/skeleton';
import type { AuditRow } from './adminShared';

export default function AuditTab() {
  const { data: audit, isLoading } = useQuery({
    queryKey: qk.admin('audit'),
    queryFn: () => api.get<{ logs: AuditRow[] }>('/api/studio/audit').then((d) => d.logs),
  });
  if (isLoading) return <SkeletonRows count={6} />;
  return (
    <ul className="space-y-1 text-xs text-muted-foreground">
      {(audit ?? []).map((a) => (
        <li key={a.id}>
          <span className="text-foreground">{a.action}</span> {a.entityType ?? ''} {a.entityId ?? ''} · {new Date(a.createdAt).toLocaleString()}
        </li>
      ))}
      {(!audit || audit.length === 0) && <li>Aucune entrée.</li>}
    </ul>
  );
}
