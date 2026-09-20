// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
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
 * Onglet Membres : qui est sur le projet, avec quel rôle et dans quels départements.
 *
 * Le rôle par projet existait depuis la phase 38.E ; le département n'avait aucun écran,
 * alors que la relation et les routes existaient depuis la vague B. Les deux se règlent
 * maintenant d'un clic droit sur la ligne — le geste que le produit emploie partout
 * ailleurs pour assigner.
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

  // Identité stable : la liste part en dépendance du filtrage de l'annuaire.
  const memberIds = useMemo(
    () => (projQ.data?.project.memberships ?? []).map((m) => m.user.id),
    [projQ.data],
  );

  return (
    <div>
      <h2 className="mb-1 text-sm font-semibold text-muted-foreground">{t('members.title')}</h2>
      {/* Le clic droit ne se devine pas : une ligne suffit à le dire, là où un bouton de
          plus par ligne alourdirait l'écran. */}
      {canManage && <p className="mb-4 text-xs text-muted-foreground">{t('members.hint')}</p>}
      {(error ?? loadError) && <p className="mb-3 text-sm text-destructive">{error ?? loadError}</p>}
      {/* Projet relié : l'équipe du site entre ici, sans ressaisir une adresse. */}
      {connection?.active && (
        <div className="mb-5">
          <SgCrewPanel projectId={projectId} />
        </div>
      )}
      {/* Le choix se fait dans l'annuaire (recherche, visage, poste), pas dans une liste
          déroulante où vingt-sept comptes homonymes se suivent. */}
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
