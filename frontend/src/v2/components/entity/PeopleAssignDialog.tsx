// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Search } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import Avatar from '../Avatar';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { initialsFrom } from '../../lib/initials';
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
  const members = useProjectMembers(projectId);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<number[]>(current.map((p) => p.id));

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return members;
    return members.filter((m) => m.name.toLocaleLowerCase().includes(needle));
  }, [members, query]);

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

        <div className="relative">
          <Search
            size={14}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            autoFocus
            className="pl-8"
            placeholder={t('assignees.searchPlaceholder')}
            aria-label={t('assignees.searchPlaceholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <div className="max-h-72 space-y-0.5 overflow-y-auto">
          {visible.length === 0 && (
            <p className="px-1 py-4 text-center text-sm text-muted-foreground">{t('assignees.noMatch')}</p>
          )}
          {visible.map((member) => {
            const checked = selected.includes(member.id);
            return (
              <button
                key={member.id}
                type="button"
                onClick={() => toggle(member.id)}
                aria-pressed={checked}
                className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors ${
                  checked ? 'bg-primary/10' : 'hover:bg-secondary/60'
                }`}
              >
                <Avatar
                  seed={member.id}
                  initials={initialsFrom(member.name)}
                  avatarUrl={member.avatarUrl}
                  size={26}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{member.name}</span>
                  <span className="block truncate text-2xs text-muted-foreground">{member.role}</span>
                </span>
                {checked && <Check size={15} className="shrink-0 text-primary" />}
              </button>
            );
          })}
        </div>

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
