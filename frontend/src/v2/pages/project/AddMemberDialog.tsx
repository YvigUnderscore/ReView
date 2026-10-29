// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/apiClient';
import { qk } from '../../lib/query';
import PeopleList from '../../components/people/PeopleList';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { Button } from '../../components/ui/button';
import { personLabel, type PersonOption } from '../../lib/peopleSearch';
import { useT } from '../../i18n';
import { useUsersQuery } from '@/v2/lib/queries';

/**
 * Who enters the project.
 *
 * The screen used to line up one native `<select>` entry per account. On a real studio that means
 * dozens of indistinguishable entries, up to twenty-seven "IT Artist" in a row, with no search, no
 * face, and nothing to tell who is who. The product's list already does all of this; it is simply
 * wired in here.
 *
 * Choosing is adding: a team rarely arrives one person at a time, and a checkbox to validate would
 * force reopening the dialog between each one. The added person therefore leaves the list on the
 * spot (the refresh of the project sheet comes later), and the dialog stays open for the next one.
 */
export default function AddMemberDialog({
  projectId,
  memberIds,
  onClose,
}: {
  projectId: number;
  /** Already in the project: these accounts are not offered. */
  memberIds: readonly number[];
  onClose: () => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const [added, setAdded] = useState<number[]>([]);
  const usersQ = useUsersQuery();

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
          // A studio where everyone is already on the project is an ordinary case, not an
          // unsuccessful search: saying so stops an empty field from looking broken.
          emptyLabel={t('members.everyoneAdded')}
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
