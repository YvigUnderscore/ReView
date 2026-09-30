// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import PeopleList from '../people/PeopleList';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { useProjectMembers } from '../../lib/useProjectRole';
import type { AssigneeRef } from '../../types/entities';
import { useT } from '../../i18n';

/**
 * Qui est responsable de cette séquence, de ce plan, de cet asset.
 *
 * L'assignation existante passe par les **tâches** : « donne cet asset à Alice » pose Alice
 * sur chacune de ses étapes. C'est la donnée juste du travail, et elle reste. Mais elle ne
 * sait pas dire « cette séquence est suivie par Bruno » quand Bruno n'a aucune tâche dessus
 * — le superviseur de séquence, la production, le lead qui couvre trois plans.
 *
 * D'où cette liste, à cocher, avec des visages : sur vingt noms qui se ressemblent, la
 * photo est ce qui rend quelqu'un reconnaissable du premier coup d'œil, et le champ de
 * recherche ce qui évite de faire défiler une équipe de cinquante personnes.
 *
 * La liste elle-même vit dans `components/people/PeopleList` depuis qu'un autre écran
 * (l'ajout de membres au projet) en avait besoin : elle y a gagné la recherche insensible
 * aux accents et la ligne d'adresse, qui départage deux comptes portant le même nom.
 */

export type AssignKind = 'sequences' | 'shots' | 'assets' | 'episodes';

export default function PeopleAssignDialog({
  projectId,
  kind,
  id,
  title,
  current,
  onClose,
  onSaved,
}: {
  projectId: number;
  kind: AssignKind;
  id: number;
  /** Ce que l'on assigne, nommé — « SH010 », « Robot ». */
  title: string;
  current: AssigneeRef[];
  onClose: () => void;
  onSaved?: (people: AssigneeRef[]) => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  // `AssignableMember` porte déjà ce que la liste attend (nom, adresse, rôle, photo) :
  // aucune conversion, le hook est la source.
  const members = useProjectMembers(projectId);
  const [selected, setSelected] = useState<number[]>(current.map((p) => p.id));

  const save = useMutation({
    mutationFn: () =>
      api
        .put<{ assignees: AssigneeRef[] }>(`/api/${kind}/${id}/assignees`, { userIds: selected })
        .then((r) => r.assignees),
    onSuccess: (people) => {
      toast.success(t('assignees.saved', { count: people.length }));
      // Les cartes portent les visages : la liste de la page doit se relire, sinon la
      // photo n'apparaîtrait qu'au prochain chargement complet.
      void qc.invalidateQueries({ queryKey: [kind, projectId] });
      void qc.invalidateQueries({ queryKey: [kind.slice(0, -1), id] });
      onSaved?.(people);
      onClose();
    },
    onError: (err: unknown) => toast.error(err instanceof Error ? err.message : t('common.error.generic')),
  });

  const toggle = (userId: number) =>
    setSelected((ids) => (ids.includes(userId) ? ids.filter((v) => v !== userId) : [...ids, userId]));

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('assignees.dialogTitle', { name: title })}</DialogTitle>
        </DialogHeader>

        <PeopleList people={members} selectedIds={selected} onPick={(person) => toggle(person.id)} />

        <DialogFooter>
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button size="sm" disabled={save.isPending} onClick={() => save.mutate()}>
            {t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
