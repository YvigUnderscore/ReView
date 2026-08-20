// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { toast } from 'sonner';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { useT } from '../../i18n';
import { useDepartments } from '../../lib/departmentsApi';
import { useProjectMembers } from '../../lib/useProjectRole';
import { UNASSIGNED } from '../../lib/assignMenu';
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';

/**
 * Assignation d'une sélection d'assets ou de plans.
 *
 * Le menu contextuel suffit pour une entité ; répartir une séquence entière au début d'un
 * lot, non — ce serait trente clics droits. La sélection existait déjà pour la mise à la
 * corbeille, elle porte maintenant aussi ce geste.
 *
 * Une entité que le serveur refuse (droits, projet archivé, aucune tâche) est comptée à
 * part plutôt que de faire échouer tout le lot, et le nombre est annoncé.
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
          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted-foreground">{t('assign.person')}</span>
            <select
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            >
              {members.map((member) => (
                <option key={member.id} value={String(member.id)}>
                  {member.name}
                </option>
              ))}
              <option value={UNASSIGNED}>{t('assign.unassigned')}</option>
            </select>
          </label>

          <fieldset className="space-y-1.5">
            <legend className="text-xs font-medium text-muted-foreground">{t('assign.departments')}</legend>
            {/* Aucune étape cochée : on vise les tâches déjà présentes. C'est le cas
              courant — « donne-moi ce lot » veut dire « tout ce qu'il reste à y faire ». */}
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
