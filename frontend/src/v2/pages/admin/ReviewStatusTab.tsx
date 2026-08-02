// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { useReviewStatusesQuery } from '../../lib/queries';
import ConfirmDialog from '../../components/ConfirmDialog';
import ReviewDecisionBadge from '../../components/ReviewDecisionBadge';
import { Button } from '../../components/ui/button';
import { SkeletonRows } from '../../components/ui/skeleton';
import type { ReviewStatus } from '../../types/api';
import ReviewStatusForm from './ReviewStatusForm';
import { useT } from '../../i18n';

/**
 * Onglet Contextes de review → Statuts (Phase 31.A) : CRUD des statuts de
 * décision personnalisables (nom, couleur, flags approbation/retake/défaut, ordre).
 */
export default function ReviewStatusTab() {
  const t = useT();
  const qc = useQueryClient();
  const { data, isLoading } = useReviewStatusesQuery();
  const [editing, setEditing] = useState<ReviewStatus | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<ReviewStatus | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: qk.reviewStatuses });
  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await api.del(`/api/review-statuses/${deleting.id}`);
      toast.success(t('reviewStatus.deleted'));
      setDeleting(null);
      invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('status.deleteFailed'));
    }
  };

  /** Échange l'ordre avec le voisin (haut/bas). */
  const move = async (index: number, dir: -1 | 1) => {
    const items = data ?? [];
    const a = items[index];
    const b = items[index + dir];
    if (!a || !b) return;
    try {
      await Promise.all([
        api.patch(`/api/review-statuses/${a.id}`, { order: b.order }),
        api.patch(`/api/review-statuses/${b.id}`, { order: a.order }),
      ]);
      invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('status.reorderFailed'));
    }
  };

  if (isLoading) return <SkeletonRows count={4} />;
  const items = data ?? [];

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-muted-foreground">{t('reviewStatus.title')}</h2>
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus size={14} /> {t('reviewStatus.new')}
        </Button>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">{t('status.hint')}</p>
      <div className="divide-y divide-border rounded-lg border border-border">
        {items.map((s, i) => (
          <div key={s.id} className="flex items-center gap-3 px-3 py-2">
            <ReviewDecisionBadge status={s} title={s.name} />
            <span className="flex-1 truncate text-xs text-muted-foreground">
              {[s.isDefault && t('common.default'), s.isApproval && 'approbation', s.isRetake && 'retake']
                .filter(Boolean)
                .join(' · ')}
            </span>
            <button
              onClick={() => move(i, -1)}
              disabled={i === 0}
              title="Monter"
              className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-30"
            >
              <ArrowUp size={13} />
            </button>
            <button
              onClick={() => move(i, 1)}
              disabled={i === items.length - 1}
              title="Descendre"
              className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-30"
            >
              <ArrowDown size={13} />
            </button>
            <button
              onClick={() => setEditing(s)}
              title={t('common.edit')}
              className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              <Pencil size={13} />
            </button>
            <button
              onClick={() => setDeleting(s)}
              title={t('common.delete')}
              className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-destructive"
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
        {items.length === 0 && (
          <p className="px-3 py-4 text-sm text-muted-foreground">{t('reviewStatus.empty')}</p>
        )}
      </div>

      {(creating || editing) && (
        <ReviewStatusForm
          status={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={() => {
            setCreating(false);
            setEditing(null);
            invalidate();
          }}
        />
      )}

      <ConfirmDialog
        open={deleting !== null}
        title={t('reviewStatus.delete.title')}
        message={
          <>« {deleting?.name} » sera supprimé. Refusé s'il est utilisé par des décisions existantes.</>
        }
        confirmLabel={t('common.delete')}
        danger
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
