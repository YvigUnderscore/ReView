// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import ConfirmDialog from '../../components/ConfirmDialog';
import { Button } from '../../components/ui/button';
import { SkeletonRows } from '../../components/ui/skeleton';
import AnnouncementForm from './AnnouncementForm';
import type { Announcement, AnnouncementAdmin, AnnouncementType } from '../../types/api';
import { useT } from '../../i18n';

const TYPE_BADGE: Record<AnnouncementType, string> = {
  INFO: 'bg-info/15 text-info',
  WARNING: 'bg-warning/15 text-warning',
  MAINTENANCE: 'bg-destructive/15 text-destructive',
};

export default function AnnouncementsTab() {
  const t = useT();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: qk.admin('announcements'),
    queryFn: () =>
      api.get<{ announcements: AnnouncementAdmin[] }>('/api/announcements').then((d) => d.announcements),
  });
  const [editing, setEditing] = useState<Announcement | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Announcement | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: qk.admin('announcements') });
  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await api.del(`/api/announcements/${deleting.id}`);
      toast.success(t('announcement.deleted'));
      setDeleting(null);
      invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Suppression impossible');
    }
  };

  if (isLoading) return <SkeletonRows count={4} />;
  const items = data ?? [];

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-muted-foreground">{t('admin.tab.announcements')}</h2>
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus size={14} /> Nouvelle annonce
        </Button>
      </div>

      <div className="space-y-1.5">
        {items.map((a) => (
          <div
            key={a.id}
            className="flex items-start justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2"
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{a.title}</span>
                <span className={`rounded px-1.5 py-0.5 text-[10px] ${TYPE_BADGE[a.type]}`}>{a.type}</span>
                {!a.active && (
                  <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    inactive
                  </span>
                )}
              </div>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">{a.body}</p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                {a.frequency} · {a.roles.length ? a.roles.join(', ') : 'tous les rôles'} · lue par{' '}
                {a._count.reads}
              </p>
            </div>
            <div className="flex shrink-0 gap-1">
              <button
                onClick={() => setEditing(a)}
                title="Modifier"
                className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
              >
                <Pencil size={15} />
              </button>
              <button
                onClick={() => setDeleting(a)}
                title={t('common.delete')}
                className="rounded p-1 text-destructive hover:bg-secondary"
              >
                <Trash2 size={15} />
              </button>
            </div>
          </div>
        ))}
        {items.length === 0 && (
          <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
            {t('announcement.empty')}
          </p>
        )}
      </div>

      {(creating || editing) && (
        <AnnouncementForm
          announcement={editing}
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
        open={!!deleting}
        title="Supprimer l'annonce ?"
        message={<>« {deleting?.title} » sera définitivement supprimée.</>}
        confirmLabel={t('common.delete')}
        danger
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
