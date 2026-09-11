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
import { useT } from '../i18n';

/** GET /api/media/drafts — brouillon + localisation lisible. */
type Draft = Pick<Media, 'id' | 'originalName' | 'kind' | 'status'> & {
  versionName: string;
  location: string;
  createdAt: string;
  /** La version porteuse : c'est elle qu'on confie en publiant. */
  versionId: number;
  /** Projet porteur — `null` sur un brouillon dont la version a perdu son rattachement. */
  projectId: number | null;
  /** Règle de consigne du projet, servie avec la ligne pour éviter un appel par brouillon. */
  reviewRequest: ReviewRequestRule | null;
};

/** Une version fraîchement livrée n'a encore été confiée à personne. */
const NO_REVIEWERS: ReviewAssignee[] = [];

/**
 * Pastille « Brouillons en attente » posée dans la barre du haut, à gauche de la
 * recherche. Liste les médias non publiés de l'utilisateur courant ; permet de les
 * publier ou supprimer rapidement depuis un panneau ancré sous la pastille.
 */
export default function PendingDrafts() {
  const t = useT();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);
  // Le brouillon dont on est en train de composer la liste de ReViewers, s'il y en a un.
  const [handingOver, setHandingOver] = useState<Draft | null>(null);
  const uploads = useUploadStore((s) => s.uploads);

  const { data } = useQuery({
    queryKey: qk.drafts,
    queryFn: () => api.get<{ drafts: Draft[] }>('/api/media/drafts').then((d) => d.drafts),
  });
  const drafts = data ?? [];

  // Recharge dès qu'un upload se termine (un nouveau brouillon peut apparaître)
  useEffect(() => {
    if (uploads.some((u) => u.status === 'done')) void qc.invalidateQueries({ queryKey: qk.drafts });
  }, [uploads, qc]);

  // Publier/supprimer un brouillon affecte aussi les listes de versions et de médias
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: qk.drafts }),
      qc.invalidateQueries({ queryKey: ['versions'] }),
      qc.invalidateQueries({ queryKey: ['media'] }),
    ]);
  /**
   * Publie, avec ou sans ReViewers.
   *
   * C'est le second endroit d'où l'on publie (l'autre étant la review elle-même), et donc
   * le second moment où dire à qui l'on confie, et quoi regarder. Le bouton direct reste :
   * livrer sans désigner personne est un cas parfaitement normal, et celui qui doit rester
   * à un clic.
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
