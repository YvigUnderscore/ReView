// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileClock, X, Trash2, Send, Eye } from 'lucide-react';
import { api } from '../../lib/apiClient';
import { qk } from '../lib/query';
import { reviewPath } from '../lib/slug';
import { useUploadStore } from '../../stores/useUploadStore';
import type { Media } from '../types/api';
import { useT } from '../i18n';

/** GET /api/media/drafts — brouillon + localisation lisible. */
type Draft = Pick<Media, 'id' | 'originalName' | 'kind' | 'status'> & {
  versionName: string;
  location: string;
  createdAt: string;
};

/**
 * Pastille flottante « Brouillons en attente » (bas-gauche). Liste les médias non
 * publiés de l'utilisateur courant ; permet de les publier ou supprimer rapidement.
 */
export default function PendingDrafts() {
  const t = useT();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);
  const uploads = useUploadStore((s) => s.uploads);

  const { data } = useQuery({
    queryKey: qk.drafts,
    queryFn: () => api.get<{ drafts: Draft[] }>('/api/media/drafts').then((d) => d.drafts),
  });
  const drafts = data ?? [];

  // Recharge dès qu'un upload se termine (un nouveau brouillon peut apparaître)
  useEffect(() => {
    if (uploads.some((u) => u.status === 'done')) qc.invalidateQueries({ queryKey: qk.drafts });
  }, [uploads, qc]);

  // Publier/supprimer un brouillon affecte aussi les listes de versions et de médias
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: qk.drafts }),
      qc.invalidateQueries({ queryKey: ['versions'] }),
      qc.invalidateQueries({ queryKey: ['media'] }),
    ]);
  const publish = async (id: number) => {
    setBusy(id);
    try {
      await api.post(`/api/media/${id}/publish`);
      await refresh();
    } finally {
      setBusy(null);
    }
  };
  const remove = async (id: number) => {
    setBusy(id);
    try {
      await api.del(`/api/media/${id}`);
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  if (drafts.length === 0) return null;

  return (
    <div className="fixed bottom-4 left-4 z-40">
      {open ? (
        <div className="flex max-h-[60vh] w-80 flex-col rounded-lg border border-border bg-card shadow-xl">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <FileClock size={15} className="text-warning" /> Brouillons en attente
              <span className="rounded-full bg-warning/15 px-1.5 text-xs text-warning">{drafts.length}</span>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="rounded p-1 text-muted-foreground hover:bg-secondary"
            >
              <X size={15} />
            </button>
          </div>
          <div className="custom-scrollbar flex-1 overflow-y-auto p-2">
            {drafts.map((d) => (
              <div key={d.id} className="mb-1.5 rounded-md border border-border bg-background p-2 text-xs">
                <div className="truncate font-medium" title={d.originalName}>
                  {d.originalName}
                </div>
                {d.location && (
                  <div className="truncate text-[11px] text-muted-foreground" title={d.location}>
                    {d.location}
                  </div>
                )}
                <div className="mt-0.5 text-[10px] text-muted-foreground">
                  {d.versionName} · {d.kind} · {d.status}
                </div>
                <div className="mt-1.5 flex items-center gap-1">
                  <Link
                    to={reviewPath(d)}
                    onClick={() => setOpen(false)}
                    className="flex items-center gap-1 rounded border border-border px-1.5 py-0.5 hover:bg-secondary/60"
                  >
                    <Eye size={11} /> {t('common.view')}
                  </Link>
                  <button
                    disabled={busy === d.id}
                    onClick={() => publish(d.id)}
                    className="flex items-center gap-1 rounded bg-primary px-1.5 py-0.5 text-primary-foreground disabled:opacity-50"
                  >
                    <Send size={11} /> Publier
                  </button>
                  <button
                    disabled={busy === d.id}
                    onClick={() => remove(d.id)}
                    title={t('common.delete')}
                    className="ml-auto flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-destructive hover:bg-secondary/60 disabled:opacity-50"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-2 rounded-full border border-warning/40 bg-warning/15 px-3 py-2 text-sm text-warning shadow-lg backdrop-blur transition-colors hover:bg-warning/25"
        >
          <FileClock size={16} />
          {drafts.length} brouillon{drafts.length > 1 ? 's' : ''} en attente
        </button>
      )}
    </div>
  );
}
