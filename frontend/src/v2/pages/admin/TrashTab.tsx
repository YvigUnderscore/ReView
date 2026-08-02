// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RotateCcw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { bulkPurge, bulkRestore } from '../../lib/bulkApi';
import { useMultiSelect } from '../../lib/useMultiSelect';
import ConfirmDialog from '../../components/ConfirmDialog';
import { Button } from '../../components/ui/button';
import { Checkbox } from '../../components/ui/checkbox';
import SelectionBar from '../../components/ui/selection-bar';
import { SkeletonRows } from '../../components/ui/skeleton';
import type { TrashProject } from './adminShared';
import { useT } from '../../i18n';

export default function TrashTab() {
  const t = useT();
  const qc = useQueryClient();
  const { data: trash, isLoading } = useQuery({
    queryKey: qk.admin('trash'),
    queryFn: () => api.get<{ projects: TrashProject[] }>('/api/admin/trash').then((d) => d.projects),
  });
  const [purge, setPurge] = useState<TrashProject | null>(null);
  const [bulkPurging, setBulkPurging] = useState(false);
  const sel = useMultiSelect(trash?.map((p) => p.id) ?? []);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: qk.admin('trash') });
    qc.invalidateQueries({ queryKey: qk.projects });
  };
  const restore = async (id: number) => {
    try {
      await api.post(`/api/projects/${id}/restore`);
      toast.success(t('adminTrash.restored'));
      invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Restauration impossible');
    }
  };
  const confirmPurge = async () => {
    if (!purge) return;
    try {
      await api.del(`/api/projects/${purge.id}/purge`);
      toast.success(t('adminTrash.deleted'));
      setPurge(null);
      invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Suppression impossible');
    }
  };

  const bulkRestoreSel = async () => {
    try {
      const { count } = await bulkRestore('projects', sel.ids);
      toast.success(`${count} projet(s) restauré(s)`);
      sel.clear();
      invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Restauration impossible');
    }
  };
  const confirmBulkPurge = async () => {
    try {
      const { count } = await bulkPurge('projects', sel.ids);
      toast.success(`${count} projet(s) supprimé(s) définitivement`);
      sel.clear();
      setBulkPurging(false);
      invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Suppression impossible');
    }
  };

  if (isLoading) return <SkeletonRows count={3} />;
  if (!trash || trash.length === 0)
    return <p className="text-sm text-muted-foreground">{t('adminTrash.empty')}</p>;
  return (
    <div className="space-y-1.5">
      <label className="flex items-center gap-2 px-3 py-1 text-xs text-muted-foreground">
        <Checkbox checked={sel.allSelected} onCheckedChange={() => sel.toggleAll()} />
        Tout sélectionner
      </label>
      {trash.map((p) => (
        <div
          key={p.id}
          className="flex items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-2 text-sm"
        >
          <div className="flex min-w-0 items-center gap-2.5">
            <div
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                sel.onSelect(p.id, { shiftKey: e.shiftKey, metaKey: e.metaKey, ctrlKey: e.ctrlKey });
              }}
            >
              <Checkbox
                checked={sel.isSelected(p.id)}
                onCheckedChange={() => {}}
                tabIndex={-1}
                aria-label={t('common.select')}
              />
            </div>
            <span className="truncate">
              {p.name}{' '}
              <span className="text-xs text-muted-foreground">
                · supprimé le {new Date(p.deletedAt).toLocaleDateString()}
              </span>
            </span>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button size="sm" variant="outline" onClick={() => restore(p.id)}>
              Restaurer
            </Button>
            <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setPurge(p)}>
              Supprimer définitivement
            </Button>
          </div>
        </div>
      ))}

      <SelectionBar
        count={sel.count}
        label="projet(s)"
        onClear={sel.clear}
        actions={[
          { label: 'Restaurer', icon: <RotateCcw size={14} />, onClick: bulkRestoreSel },
          {
            label: t('common.deletePermanently'),
            icon: <Trash2 size={14} />,
            danger: true,
            onClick: () => setBulkPurging(true),
          },
        ]}
      />

      <ConfirmDialog
        open={bulkPurging}
        title={t('adminTrash.deleteMany.title')}
        message={
          <>
            {sel.count} projet(s) et tous leurs médias seront supprimés de la base et du stockage.
            Irréversible.
          </>
        }
        confirmLabel={t('common.deletePermanently')}
        danger
        onConfirm={confirmBulkPurge}
        onCancel={() => setBulkPurging(false)}
      />
      <ConfirmDialog
        open={!!purge}
        title={t('adminTrash.delete.title')}
        message={
          <>« {purge?.name} » et tous ses médias seront supprimés de la base et du stockage. Irréversible.</>
        }
        confirmLabel={t('common.deletePermanently')}
        danger
        onConfirm={confirmPurge}
        onCancel={() => setPurge(null)}
      />
    </div>
  );
}
