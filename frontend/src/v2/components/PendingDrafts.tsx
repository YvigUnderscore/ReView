// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileClock, X, Trash2, Send, Eye, UserPlus } from 'lucide-react';
import { api } from '../../lib/apiClient';
import { qk } from '../lib/query';
import { reviewPath } from '../lib/slug';
import { useUploadStore } from '../../stores/useUploadStore';
import type { Media, ReviewRequestRule } from '../types/api';
import type { ReviewAssignee } from '../types/entities';
import ReviewersDialog from './review/ReviewersDialog';
import { useDraftMode } from '../lib/draftMode';
import { useT } from '../i18n';

/** GET /api/media/drafts — brouillon + localisation lisible. */
type Draft = Pick<Media, 'id' | 'originalName' | 'kind' | 'status'> & {
  versionName: string;
  location: string;
  createdAt: string;
  /** The carrying version: it is the one entrusted when publishing. */
  versionId: number;
  /** Carrying project: `null` for a draft whose version has lost its attachment. */
  projectId: number | null;
  /** Project review rule, served with the row to avoid one call per draft. */
  reviewRequest: ReviewRequestRule | null;
};

/** A freshly delivered version has not yet been entrusted to anyone. */
const NO_REVIEWERS: ReviewAssignee[] = [];

/**
 * "Pending drafts" badge placed in the top bar, to the left of the
 * search. Lists the unpublished media of the current user; allows publishing them or
 * deleting them quickly from a panel anchored under the badge.
 *
 * It only exists in a studio that kept the two-step workflow (`draftMode`,
 * Phase 50). Elsewhere a media is born published: the badge would never have anything to show, and
 * its request would be a round trip paid by every page of every account.
 */
export default function PendingDrafts() {
  const t = useT();
  const qc = useQueryClient();
  const draftMode = useDraftMode();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);
  // The draft whose ReViewers list is being composed, if there is one.
  const [handingOver, setHandingOver] = useState<Draft | null>(null);
  const uploads = useUploadStore((s) => s.uploads);

  const { data } = useQuery({
    queryKey: qk.drafts,
    queryFn: () => api.get<{ drafts: Draft[] }>('/api/media/drafts').then((d) => d.drafts),
    enabled: draftMode,
  });
  const drafts = data ?? [];

  // Reloads as soon as an upload ends (a new draft may appear).
  useEffect(() => {
    if (draftMode && uploads.some((u) => u.status === 'done'))
      void qc.invalidateQueries({ queryKey: qk.drafts });
  }, [draftMode, uploads, qc]);

  // Publishing or deleting a draft also affects the version and media lists
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: qk.drafts }),
      qc.invalidateQueries({ queryKey: ['versions'] }),
      qc.invalidateQueries({ queryKey: ['media'] }),
    ]);
  /**
   * Publishes, with or without ReViewers.
   *
   * This is the second place from which one publishes (the other being the review itself), and therefore
   * the second moment to say to whom one entrusts it, and what to look at. The direct button remains:
   * delivering without designating anyone is a perfectly normal case, and it must remain
   * one click away.
   */
  const publish = async (id: number, reviewers?: { userId: number; note: string | null }[]) => {
    setBusy(id);
    try {
      await api.post(`/api/media/${id}/publish`, reviewers ? { reviewers } : {});
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
    <div className="relative shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        title={t('drafts.title')}
        className="flex items-center gap-2 rounded-full border border-warning/40 bg-warning/15 px-3 py-1.5 text-sm text-warning transition-colors hover:bg-warning/25"
      >
        <FileClock size={16} />
        <span className="hidden sm:inline">{t('drafts.count', { count: drafts.length })}</span>
      </button>
      {open && (
        <div className="absolute right-0 top-[calc(100%+0.5rem)] z-50 flex max-h-[60vh] w-80 flex-col rounded-lg border border-border bg-card shadow-xl">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <FileClock size={15} className="text-warning" /> {t('drafts.title')}
              <span className="rounded-full bg-warning/15 px-1.5 text-xs text-warning">{drafts.length}</span>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="rounded p-1.5 text-muted-foreground hover:bg-secondary"
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
                  <div className="truncate text-xs text-muted-foreground" title={d.location}>
                    {d.location}
                  </div>
                )}
                <div className="mt-0.5 text-2xs text-muted-foreground">
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
                    <Send size={11} /> {t('common.publish')}
                  </button>
                  {/* Sans projet résolu, il n'y a ni annuaire à proposer ni règle à faire
                      respecter : le bouton direct reste, celui-ci s'efface. */}
                  {d.projectId !== null && (
                    <button
                      disabled={busy === d.id}
                      onClick={() => setHandingOver(d)}
                      title={t('reviewers.publishTitle')}
                      aria-label={t('reviewers.publishTitle')}
                      className="flex items-center gap-1 rounded border border-border px-1.5 py-0.5 hover:bg-secondary/60 disabled:opacity-50"
                    >
                      <UserPlus size={11} />
                    </button>
                  )}
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
      )}
      {handingOver?.projectId != null && (
        <ReviewersDialog
          open
          onOpenChange={(isOpen) => !isOpen && setHandingOver(null)}
          projectId={handingOver.projectId}
          reviewers={NO_REVIEWERS}
          rule={handingOver.reviewRequest ?? { requireNote: false, minNoteLength: 5 }}
          title={t('reviewers.publishTitle')}
          description={t('reviewers.publishHint')}
          submitLabel={t('common.publish')}
          busy={busy === handingOver.id}
          onSubmit={async (reviewers) => {
            await publish(handingOver.id, reviewers);
            setHandingOver(null);
          }}
        />
      )}
    </div>
  );
}
