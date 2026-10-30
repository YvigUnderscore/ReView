// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/apiClient';
import PeopleList from '../people/PeopleList';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { useProjectMembers } from '../../lib/useProjectRole';
import type { AssigneeRef } from '../../types/entities';
import { useT } from '../../i18n';

/**
 * Who is responsible for this sequence, shot or asset.
 *
 * Existing assignment goes through the **tasks**: "give this asset to Alice" puts Alice on each of its steps. That is
 * the right data about the work, and it stays. But it cannot say "this sequence is followed by Bruno" when Bruno has no
 * task on it: the sequence supervisor, production, the lead covering three shots.
 *
 * Hence this list, with checkboxes and faces: among twenty similar names, the photo is what makes someone recognisable
 * at a glance, and the search field is what spares scrolling through a team of fifty people.
 *
 * The list itself lives in `components/people/PeopleList`, since another screen (adding members to the project) needed
 * it: it gained accent-insensitive search and the address line, which tells apart two accounts bearing the same name.
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
  /** What is being assigned, named: "SH010", "Robot". */
  title: string;
  current: AssigneeRef[];
  onClose: () => void;
  onSaved?: (people: AssigneeRef[]) => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  // `AssignableMember` already carries what the list expects (name, address, role, photo): no conversion,
  // the hook is the source.
  const members = useProjectMembers(projectId);
  const [selected, setSelected] = useState<number[]>(current.map((p) => p.id));

  const save = useMutation({
    mutationFn: () =>
      api
        .put<{ assignees: AssigneeRef[] }>(`/api/${kind}/${id}/assignees`, { userIds: selected })
        .then((r) => r.assignees),
    onSuccess: (people) => {
      toast.success(t('assignees.saved', { count: people.length }));
      // The cards carry faces: the list must be readable again, otherwise the photo would only appear on
      // the next full load.
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
