// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../../lib/apiClient';
import { qk } from '../lib/query';
import { useReviewStatusesQuery } from '../lib/queries';
import { timeAgo } from '../lib/time';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { Textarea } from './ui/textarea';
import ReviewDecisionBadge from './ReviewDecisionBadge';
import { pickPreselectedStatus, reviewStatusStyle } from './reviewDecision.helpers';
import type { ReviewDecision, ReviewStatus } from '../types/api';
import { useT } from '../i18n';

/**
 * Décision de review d'une version (Phase 31) : pose d'un statut (SUPERVISOR+)
 * avec commentaire optionnel + historique complet (qui/quand/commentaire).
 * Ouvert depuis le clic droit d'une carte de version ou l'en-tête de review.
 */
export default function ReviewDecisionDialog({
  versionId,
  versionName,
  open,
  onOpenChange,
  canDecide,
}: {
  versionId: number;
  versionName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canDecide: boolean;
}) {
  const t = useT();
  const qc = useQueryClient();
  const statusesQ = useReviewStatusesQuery(open);
  const historyQ = useQuery({
    queryKey: qk.versionDecisions(versionId),
    queryFn: () =>
      api
        .get<{ decisions: ReviewDecision[] }>(`/api/versions/${versionId}/decisions`)
        .then((d) => d.decisions),
    enabled: open,
  });
  // Référence stable exigée par l'effet de pré-sélection (exhaustive-deps).
  const statuses = useMemo(() => statusesQ.data ?? [], [statusesQ.data]);
  const history = historyQ.data ?? [];
  const current = history[0]?.status ?? null;

  const [statusId, setStatusId] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);

  // Pré-sélection : décision courante, sinon statut par défaut du studio.
  useEffect(() => {
    if (!open) return;
    setComment('');
    setStatusId(pickPreselectedStatus(current, statuses));
  }, [open, current, statuses]);

  const submit = async () => {
    if (statusId === null) return;
    setSaving(true);
    try {
      await api.post(`/api/versions/${versionId}/decision`, {
        statusId,
        ...(comment.trim() ? { comment: comment.trim() } : {}),
      });
      toast.success(t('decision.saved'));
      await Promise.all([
        qc.invalidateQueries({ queryKey: qk.versionDecisions(versionId) }),
        qc.invalidateQueries({ queryKey: ['versions'] }),
        qc.invalidateQueries({ queryKey: qk.version(versionId) }),
        qc.invalidateQueries({ queryKey: ['reviews'] }),
      ]);
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('decision.notSaved'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Décision de review — {versionName}</DialogTitle>
          <DialogDescription>
            {current ? (
              <>
                {t('decision.current')} <ReviewDecisionBadge status={current} />
              </>
            ) : (
              t('decision.none')
            )}
          </DialogDescription>
        </DialogHeader>

        {canDecide && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-1.5">
              {statuses.map((s: ReviewStatus) => (
                <button
                  key={s.id}
                  onClick={() => setStatusId(s.id)}
                  className={`rounded-md border px-2 py-1 text-xs transition-colors ${
                    statusId === s.id ? 'ring-1 ring-ring' : 'opacity-70 hover:opacity-100'
                  }`}
                  style={reviewStatusStyle(s.color, statusId === s.id)}
                >
                  {s.name}
                </button>
              ))}
            </div>
            <Textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={t('decision.comment.placeholder')}
              rows={2}
            />
            <div className="flex justify-end">
              <Button size="sm" onClick={submit} disabled={saving || statusId === null}>
                {t('decision.set')}
              </Button>
            </div>
          </div>
        )}

        <div className="max-h-56 space-y-2 overflow-y-auto border-t border-border pt-3">
          {history.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('decision.empty')}</p>
          ) : (
            history.map((d) => (
              <div key={d.id} className="flex items-start gap-2 text-xs">
                <ReviewDecisionBadge status={d.status} />
                <div className="min-w-0">
                  <span className="text-muted-foreground">
                    {d.author?.name ?? t('admin.tab.system')} · {timeAgo(d.createdAt)}
                  </span>
                  {d.comment && <p className="mt-0.5 text-foreground">{d.comment}</p>}
                </div>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
