// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import ConfirmDialog from '../../components/ConfirmDialog';
import { Button } from '../../components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { entriesOf, separator, type MenuEntry } from '../../lib/menuSpec';
import { useProjectRole } from '../../lib/useProjectRole';
import { useStatusMenu } from '../../lib/useStatusMenu';
import { useTaskAssignMenu } from '../../lib/useTaskAssignMenu';
import { useAuth } from '../../stores/useAuth';
import type { StatusChoice } from '../../lib/statusMenu';
import type { BoardTask } from './kanbanTypes';
import { useT } from '../../i18n';

/**
 * Le menu d'une carte de kanban : statut, assignation, étape, renommage, suppression.
 *
 * Aucune de ces actions n'existait à l'écran : le board ne savait que déplacer une carte
 * d'une colonne à l'autre. Renommer et supprimer une tâche née d'un retour de review
 * demandait un aller-retour par le site ShotGrid — impossible sur un projet autonome.
 *
 * **Mémoïsation.** Les cartes sont mémoïsées sur `(task, menuFor)` : c'est ce qui permet à
 * une frappe dans la recherche de ne pas rejouer mille cartes. `menuFor` ne peut donc pas
 * dépendre des constructeurs d'entrées, qui sont neufs à chaque rendu ; il dépend d'une
 * *signature* de ce qu'ils lisent (`epoch`). Toute entrée nouvelle doit entrer dans cette
 * signature, sans quoi le menu se figera sur des données périmées — ou le board se rendra
 * en entier à chaque lettre tapée.
 */
export function useKanbanCardMenu(
  projectId: number,
  applyOptimisticStatus: (taskId: number, choice: StatusChoice | null) => () => void,
): { menuFor: (task: BoardTask) => MenuEntry[]; dialogs: ReactNode } {
  const t = useT();
  const qc = useQueryClient();
  const myId = useAuth((s) => s.user?.id);
  const { canManage } = useProjectRole(projectId);
  const { entry: statusEntry, choices } = useStatusMenu(projectId, 'task');
  const { assignEntry, departmentEntry, epoch: assignEpoch } = useTaskAssignMenu(projectId);
  const [renaming, setRenaming] = useState<BoardTask | null>(null);
  const [draft, setDraft] = useState('');
  const [deleting, setDeleting] = useState<BoardTask | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () => void qc.invalidateQueries({ queryKey: qk.projectBoard(projectId) });

  const openRename = useCallback((task: BoardTask) => {
    setDraft(task.name);
    setRenaming(task);
  }, []);

  const rename = async () => {
    const name = draft.trim();
    if (!renaming || name === '' || name === renaming.name) return setRenaming(null);
    setBusy(true);
    try {
      await api.patch(`/api/tasks/${renaming.id}`, { name });
      setRenaming(null);
      refresh();
      void qc.invalidateQueries({ queryKey: qk.task(renaming.id) });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error.generic'));
    } finally {
      setBusy(false);
    }
  };

  /**
   * Supprimer une tâche emporte ses versions (`onDelete: Cascade`). Le serveur refuse donc
   * une tâche qui en porte, avec un message qui dit combien : c'est cette réponse qu'on
   * affiche, plutôt que de recompter ici ce que le board ne sait pas de source sûre.
   */
  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await api.del(`/api/tasks/${deleting.id}`);
      setDeleting(null);
      refresh();
      toast.success(t('task.deleted', { name: deleting.name }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error.generic'));
    } finally {
      setBusy(false);
    }
  };

  /** Ce dont le menu dépend réellement — cf. l'encart de mémoïsation ci-dessus. */
  const epoch = [
    projectId,
    canManage,
    myId ?? 0,
    assignEpoch,
    t('pipeline.status.menu'),
    ...choices.map((c) => `${c.value}:${c.label}:${c.color ?? ''}`),
  ].join('|');

  const menuFor = useCallback(
    (task: BoardTask): MenuEntry[] =>
      entriesOf(
        // L'assigné change son propre statut : c'est exactement ce que le serveur accepte
        // de lui, et le geste le plus utile de l'écran pour un artiste.
        statusEntry(task, {
          canEdit: canManage || task.assignee?.id === myId,
          onOptimistic: (choice) => applyOptimisticStatus(task.id, choice),
        }),
        assignEntry({ id: task.id, assigneeId: task.assignee?.id ?? null }, canManage),
        departmentEntry({ id: task.id, department: task.department }, canManage),
        canManage ? separator('task-edit') : null,
        canManage
          ? {
              id: 'task-rename',
              label: t('task.rename'),
              icon: <Pencil size={14} />,
              onSelect: () => openRename(task),
            }
          : null,
        canManage
          ? {
              id: 'task-delete',
              label: t('task.delete'),
              icon: <Trash2 size={14} />,
              danger: true,
              onSelect: () => setDeleting(task),
            }
          : null,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- gouverné par `epoch`, cf. ci-dessus
    [epoch, applyOptimisticStatus, openRename],
  );

  const dialogs = (
    <>
      <Dialog
        open={renaming !== null}
        onOpenChange={(o) => {
          if (!o) setRenaming(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('task.rename')}</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void rename();
            }}
          >
            <label className="block space-y-1">
              <span className="text-xs font-medium text-muted-foreground">{t('task.nameLabel')}</span>
              <input
                autoFocus
                value={draft}
                maxLength={160}
                onChange={(e) => setDraft(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </label>
            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={() => setRenaming(null)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" size="sm" disabled={busy || draft.trim() === ''}>
                {t('common.save')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={deleting !== null}
        danger
        title={t('task.delete')}
        message={t('task.deleteConfirm', { name: deleting?.name ?? '' })}
        confirmLabel={t('common.delete')}
        onCancel={() => setDeleting(null)}
        onConfirm={() => void remove()}
      />
    </>
  );

  return { menuFor, dialogs };
}
