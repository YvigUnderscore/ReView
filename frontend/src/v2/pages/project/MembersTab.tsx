// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/apiClient';
import { qk } from '../../lib/query';
import { Button } from '../../components/ui/button';
import AddMemberDialog from './AddMemberDialog';
import MemberRow from './MemberRow';
import { useProjectRole } from '../../lib/useProjectRole';
import type { Member } from './projectTypes';
import type { Role } from '../../types/api';
import { useT } from '../../i18n';
import { useSgConnection } from '../../lib/shotgridApi';
import SgCrewPanel from '../../components/shotgrid/SgCrewPanel';

/**
 * Members tab: who is on the project, with which role and in which departments.
 *
 * The per-project role has existed since phase 38.E; the department had no screen, although the
 * relation and the routes had existed since wave B. Both are now set with a right-click on the row,
 * the gesture the product uses everywhere else to assign.
 */
export default function MembersTab({ projectId }: { projectId: number }) {
  const t = useT();
  const qc = useQueryClient();
  const { canManage } = useProjectRole(projectId);
  const projQ = useQuery({
    queryKey: qk.project(projectId),
    queryFn: () => api.get<{ project: { memberships: Member[] } }>(`/api/projects/${projectId}`),
  });
  const members = projQ.data?.project.memberships ?? [];
  const loadError = projQ.error?.message ?? null;
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const invalidate = () => void qc.invalidateQueries({ queryKey: qk.project(projectId) });
  const { data: connection } = useSgConnection(projectId);

  const setRole = async (userId: number, role: Role | undefined) => {
    try {
      await api.post(`/api/projects/${projectId}/members`, { userId, role });
      toast.success(t('members.roleUpdated'));
      invalidate();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error.generic'));
    }
  };
  const remove = async (userId: number) => {
    try {
      await api.del(`/api/projects/${projectId}/members/${userId}`);
      toast.success(t('members.removed'));
      invalidate();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error.generic'));
    }
  };

  // Stable identity: the list feeds the dependency of the directory filtering.
  const memberIds = useMemo(
    () => (projQ.data?.project.memberships ?? []).map((m) => m.user.id),
    [projQ.data],
  );

  return (
    <div>
      <h2 className="mb-1 text-sm font-semibold text-muted-foreground">{t('members.title')}</h2>
      {/* Right-click is not guessable: a row is enough to say so, whereas one more button per row
          would weigh down the screen. */}
      {canManage && <p className="mb-4 text-xs text-muted-foreground">{t('members.hint')}</p>}
      {(error ?? loadError) && <p className="mb-3 text-sm text-destructive">{error ?? loadError}</p>}
      {/* Linked project: the site's team comes in here, without retyping an address. */}
      {connection?.active && (
        <div className="mb-5">
          <SgCrewPanel projectId={projectId} />
        </div>
      )}
      {/* The choice is made in the directory (search, face, role), not in a drop-down list where
          twenty-seven namesakes follow each other. */}
      <Button size="sm" className="mb-5" onClick={() => setAdding(true)}>
        <Plus size={14} /> {t('members.add')}
      </Button>
      {adding && (
        <AddMemberDialog projectId={projectId} memberIds={memberIds} onClose={() => setAdding(false)} />
      )}
      <div className="space-y-1.5">
        {members.map((m) => (
          <MemberRow
            key={m.user.id}
            projectId={projectId}
            member={m}
            sgLinked={Boolean(connection?.active)}
            canManage={canManage}
            onRole={(userId, role) => void setRole(userId, role)}
            onRemove={(userId) => void remove(userId)}
          />
        ))}
        {members.length === 0 && <p className="text-sm text-muted-foreground">{t('members.empty')}</p>}
      </div>
    </div>
  );
}
