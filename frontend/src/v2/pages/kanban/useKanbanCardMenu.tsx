// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/apiClient';
import { qk } from '../../lib/query';
import ConfirmDialog from '../../components/ConfirmDialog';
import { Button } from '../../components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { entriesOf, separator, type MenuEntry } from '../../lib/menuSpec';
import { useProjectRole } from '../../lib/useProjectRole';
import { useStatusMenu } from '../../lib/useStatusMenu';
import { useTaskAssignMenu } from '../../lib/useTaskAssignMenu';
import { useUndoToast } from '../../lib/useUndoToast';
import { useAuth } from '../../stores/useAuth';
import type { StatusChoice } from '../../lib/statusMenu';
import type { BoardTask } from './kanbanTypes';
import { useT } from '../../i18n';

/**
 * The menu of a kanban card: status, assignment, step, renaming, deletion.
 *
 * None of these actions existed on screen: the board could only move a card from one column to
 * another. Renaming and deleting a task born from a review feedback required a round trip to the
 * ShotGrid site, which was impossible on a standalone project.
 *
 * **Memoization.** The cards are memoized on `(task, menuFor)`: this is what allows a keystroke in
 * the search not to replay a thousand cards. `menuFor` therefore cannot depend on the entry
 * builders, which are new on each render; it depends on a *signature* of what they read (`epoch`).
 * Any new entry must enter this signature, otherwise the menu freezes on stale data, or the board
 * renders in full at every letter typed.
 */
export function useKanbanCardMenu(
  projectId: number,
  applyOptimisticStatus: (taskId: number, choice: StatusChoice | null) => () => void,
): { menuFor: (task: BoardTask) => MenuEntry[]; dialogs: ReactNode } {
  const t = useT();
  const qc = useQueryClient();
  const { done } = useUndoToast();
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

  /** The bare name write: it lets its failure propagate (the undo replays it). */
  const writeName = async (taskId: number, name: string): Promise<void> => {
    await api.patch(`/api/tasks/${taskId}`, { name });
    refresh();
    void qc.invalidateQueries({ queryKey: qk.task(taskId) });
  };

  /**
   * Renames, and offers to put the old name back in the toast.
   *
   * The input field does have the browser's Ctrl+Z, but it is useless once the dialog is closed:
   * the name has already gone to the server. The reverse, however, is held exactly: it is the same
   * route with the previous string.
   */
  const rename = async () => {
    const name = draft.trim();
    if (!renaming || name === '' || name === renaming.name) return setRenaming(null);
    const task = renaming;
    setBusy(true);
    try {
      await writeName(task.id, name);
      setRenaming(null);
      done(t('task.renamed', { name }), () => writeName(task.id, task.name));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error.generic'));
    } finally {
      setBusy(false);
    }
  };

  /**
   * Deleting a task takes its versions with it (`onDelete: Cascade`). The server therefore refuses
   * a task that carries some, with a message saying how many: that answer is what gets displayed,
   * rather than recounting here what the board does not know from a reliable source.
   *
   * **No undo is offered, and that is deliberate.** Nothing restores a task: there is no task
   * trash on the server side, and recreating it would yield a DIFFERENT task (new identifier, lost
   * history, broken comment and review links, ShotGrid line already deleted from the site). An
   * "Undo" would promise what cannot be delivered. The safeguard remains the confirmation, upstream,
   * where it is honest.
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

  /** What the menu actually depends on: see the memoization note above. */
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
        // The assignee changes their own status: exactly what the server accepts from them, and
        // the most useful gesture on the screen for an artist.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- governed by `epoch`, see above
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
