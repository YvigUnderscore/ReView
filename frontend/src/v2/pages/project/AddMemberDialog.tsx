// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import PeopleList from '../../components/people/PeopleList';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { Button } from '../../components/ui/button';
import { personLabel, type PersonOption } from '../../lib/peopleSearch';
import type { User } from '../../types/api';
import { useT } from '../../i18n';

/**
 * Qui entre dans le projet.
 *
 * L'écran alignait un `<select>` natif d'un compte par ligne : sur un vrai studio, des
 * dizaines d'entrées indiscernables — jusqu'à vingt-sept « IT Artist » à la suite — sans
 * recherche, sans visage, sans rien pour savoir de qui il s'agit. La liste du produit sait
 * déjà faire tout cela ; elle est simplement branchée ici.
 *
 * Le choix vaut l'ajout : une équipe arrive rarement une personne à la fois, et une
 * validation à cocher obligerait à rouvrir le dialogue entre chaque. La personne ajoutée
 * quitte donc la liste sur-le-champ (le rafraîchissement de la fiche projet arrive après),
 * et le dialogue reste ouvert pour la suivante.
 */
export default function AddMemberDialog({
  projectId,
  memberIds,
  onClose,
}: {
  projectId: number;
  /** Déjà dans le projet : ces comptes ne sont pas proposés. */
  memberIds: readonly number[];
  onClose: () => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const [added, setAdded] = useState<number[]>([]);
  const usersQ = useQuery({
    queryKey: qk.users,
    queryFn: () => api.get<{ users: User[] }>('/api/users').then((d) => d.users),
  });

  const people = useMemo<PersonOption[]>(
    () =>
      (usersQ.data ?? []).map((user) => ({
        id: user.id,
        name: personLabel(user),
        email: user.email,
        jobTitle: user.jobTitle ?? null,
        role: user.role,
        avatarUrl: user.avatarUrl ?? null,
        initials: user.initials,
      })),
    [usersQ.data],
  );
  const excludeIds = useMemo(() => [...memberIds, ...added], [memberIds, added]);

  const add = useMutation({
    mutationFn: (userId: number) => api.post(`/api/projects/${projectId}/members`, { userId }),
    onSuccess: (_result, userId) => {
      setAdded((ids) => [...ids, userId]);
      toast.success(t('members.added'));
      void qc.invalidateQueries({ queryKey: qk.project(projectId) });
    },
    onError: (err: unknown) => toast.error(err instanceof Error ? err.message : t('common.error.generic')),
  });

  const loadError = usersQ.error?.message ?? null;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('members.add')}</DialogTitle>
        </DialogHeader>
        {loadError && <p className="mb-2 text-sm text-destructive">{loadError}</p>}
        <PeopleList
          people={people}
          excludeIds={excludeIds}
          onPick={(person) => add.mutate(person.id)}
          pendingId={add.isPending ? (add.variables ?? null) : null}
        />
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>
            {t('common.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
