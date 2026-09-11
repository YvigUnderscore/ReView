// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UserPlus, X } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../lib/apiClient';
import { qk } from '../lib/query';
import { assigneeName } from '../lib/assigneeName';
import { useProjectMembers } from '../lib/useProjectRole';
import PeopleList from './people/PeopleList';
import AssigneeStack from './entity/AssigneeStack';
import type { AssigneeRef } from '../types/entities';
import { useT } from '../i18n';

/**
 * À qui la review de cette version est confiée (Phase 49).
 *
 * La décision de review disait ce qu'on avait conclu d'une livraison ; rien ne disait à
 * qui on demandait de la regarder. Ça se disait de vive voix, et l'artiste comme le
 * superviseur perdaient la trace de la file en cours. C'est le même geste que
 * « responsables d'un plan » et il en reprend la forme — mêmes visages, même annuaire
 * cherchable — pour que l'assignation se lise partout de la même façon.
 *
 * Écriture immédiate : cliquer un nom l'ajoute, le recliquer le retire. Un bouton
 * « Enregistrer » aurait ajouté un pied de page à une modale qui en a déjà un (la pose de
 * décision), et une liste à cocher dont on peut sortir sans valider ment sur son état.
 */
export default function ReviewAssignees({
  versionId,
  projectId,
  canAssign,
  enabled = true,
}: {
  versionId: number;
  /** Restreint l'annuaire aux membres du projet — le serveur refuse les autres de toute façon. */
  projectId?: number;
  /** Seul un gestionnaire du projet répartit les reviews ; les autres lisent la liste. */
  canAssign: boolean;
  /** Laissé à `false` tant que la modale porteuse est fermée : rien n'est demandé. */
  enabled?: boolean;
}) {
  const t = useT();
  const qc = useQueryClient();
  const [picking, setPicking] = useState(false);
  const [pendingId, setPendingId] = useState<number | null>(null);
  const members = useProjectMembers(projectId ?? 0);

  const reviewersQ = useQuery({
    queryKey: qk.versionReviewers(versionId),
    queryFn: () =>
      api.get<{ reviewers: AssigneeRef[] }>(`/api/versions/${versionId}/reviewers`).then((d) => d.reviewers),
    enabled,
  });
  const reviewers = reviewersQ.data ?? [];

  const save = useMutation({
    mutationFn: (userIds: number[]) =>
      api
        .put<{ reviewers: AssigneeRef[] }>(`/api/versions/${versionId}/reviewers`, { userIds })
        .then((d) => d.reviewers),
    onSuccess: (people) => {
      qc.setQueryData(qk.versionReviewers(versionId), people);
      // L'encart « Assigned to me » de la page Reviews lit la même donnée : sans cette
      // invalidation, la personne qu'on vient d'assigner ne la verrait qu'au rechargement.
      void qc.invalidateQueries({ queryKey: ['reviews'] });
      toast.success(t('reviewers.saved', { count: people.length }));
    },
    onError: (err: unknown) => toast.error(err instanceof Error ? err.message : t('common.error.generic')),
    onSettled: () => setPendingId(null),
  });

  const toggle = (userId: number) => {
    const ids = reviewers.map((p) => p.id);
    setPendingId(userId);
    save.mutate(ids.includes(userId) ? ids.filter((id) => id !== userId) : [...ids, userId]);
  };

  return (
    <div className="space-y-2 border-t border-border pt-3">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold section-label text-muted-foreground">
          {t('reviewers.title')}
        </span>
        {canAssign && (
          <button
            type="button"
            onClick={() => setPicking((open) => !open)}
            aria-expanded={picking}
            className="ml-auto flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            {picking ? <X size={13} /> : <UserPlus size={13} />}
            {picking ? t('common.close') : t('reviewers.assign')}
          </button>
        )}
      </div>

      {reviewers.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('reviewers.none')}</p>
      ) : (
        <div className="flex items-center gap-2">
          <AssigneeStack people={reviewers} size={22} />
          <span className="min-w-0 truncate text-xs text-muted-foreground">
            {reviewers.map(assigneeName).join(', ')}
          </span>
        </div>
      )}

      {picking && canAssign && (
        <PeopleList
          people={members}
          selectedIds={reviewers.map((p) => p.id)}
          pendingId={pendingId}
          onPick={(person) => toggle(person.id)}
        />
      )}
    </div>
  );
}
