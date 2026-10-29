// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { toast } from 'sonner';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/apiClient';
import { qk } from '../../lib/query';
import { useT } from '../../i18n';
import { useDepartments } from '../../lib/departmentsApi';
import { useProjectMembers } from '../../lib/useProjectRole';
import { UNASSIGNED } from '../../lib/assignMenu';
import PeopleList from '../people/PeopleList';
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';

/**
 * Assigns a selection of assets or shots.
 *
 * The context menu is enough for a single entity; spreading a whole sequence across a batch is not:
 * that would be thirty right-clicks. The selection already existed for moving to the trash, and it
 * now carries this gesture too.
 *
 * An entity the server refuses (rights, archived project, no task) is counted separately rather
 * than failing the whole batch, and the count is announced.
 */
export default function BulkAssignDialog({
  projectId,
  holder,
  ids,
  onClose,
  onDone,
}: {
  projectId: number;
  holder: 'assets' | 'shots';
  ids: number[];
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const members = useProjectMembers(projectId);
  const { data: departments = [] } = useDepartments(projectId, projectId > 0);
  const [userId, setUserId] = useState<string>(members[0] ? String(members[0].id) : UNASSIGNED);
  const [selected, setSelected] = useState<number[]>([]);

  const assign = useMutation({
    mutationFn: () =>
      api.patch<{ updated: number; created: number; skipped: number }>(`/api/bulk/${holder}/assign`, {
        ids,
        userId: userId === UNASSIGNED ? null : Number(userId),
        ...(selected.length > 0 ? { departmentIds: selected } : {}),
      }),
  });

  const submit = async () => {
    try {
      const result = await assign.mutateAsync();
      toast.success(t('assign.doneCount', { count: result.updated }));
      if (result.skipped > 0) toast.warning(t('assign.skippedCount', { count: result.skipped }));
      void qc.invalidateQueries({ queryKey: [holder, projectId] });
      void qc.invalidateQueries({ queryKey: qk.projectBoard(projectId) });
      onDone();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('assign.failed'));
    }
  };

  const toggle = (id: number) =>
    setSelected((current) => (current.includes(id) ? current.filter((d) => d !== id) : [...current, id]));

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogTitle className="text-sm">{t('assign.bulkTitle', { count: ids.length })}</DialogTitle>
        <div className="space-y-4">
          <fieldset className="space-y-1.5">
            <legend className="text-xs font-medium text-muted-foreground">{t('assign.person')}</legend>
            {/* Same directory as everywhere else: on a team of fifty, a dropdown of names does not say
              which of two namesakes is meant. */}
            <PeopleList
              people={members}
              selectedIds={userId === UNASSIGNED ? [] : [Number(userId)]}
              onPick={(person) => setUserId(String(person.id))}
            />
            {/* "Nobody" is not someone: the choice stays out of the list. */}
            <button
              type="button"
              onClick={() => setUserId(UNASSIGNED)}
              aria-pressed={userId === UNASSIGNED}
              className={`w-full rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                userId === UNASSIGNED
                  ? 'bg-primary/10 text-foreground'
                  : 'text-muted-foreground hover:bg-secondary/60'
              }`}
            >
              {t('assign.unassigned')}
            </button>
          </fieldset>

          <fieldset className="space-y-1.5">
            <legend className="text-xs font-medium text-muted-foreground">{t('assign.departments')}</legend>
            {/* No step checked: we target the tasks already present. This is the common case, since
              "give me this batch" means "everything still left to do on it". */}
            <p className="text-xs text-muted-foreground">{t('assign.departmentsHint')}</p>
            <div className="flex flex-wrap gap-1.5">
              {departments.map((department) => (
                <button
                  key={department.id}
                  type="button"
                  onClick={() => toggle(department.id)}
                  aria-pressed={selected.includes(department.id)}
                  className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                    selected.includes(department.id)
                      ? 'border-primary bg-primary/15 text-foreground'
                      : 'border-border text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {department.name}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button size="sm" onClick={() => void submit()} disabled={assign.isPending}>
              {t('assign.apply')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
