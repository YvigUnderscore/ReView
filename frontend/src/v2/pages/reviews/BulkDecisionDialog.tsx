// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { useReviewStatusesQuery } from '../../lib/queries';
import { useTheme } from '../../stores/useTheme';
import { reviewStatusStyle } from '../../components/reviewDecision.helpers';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { Textarea } from '../../components/ui/textarea';
import type { ReviewStatus } from '../../types/api';
import { useT } from '../../i18n';

/**
 * Même décision de review sur une sélection de médias.
 *
 * Une session de dailies se solde par trente « retake » et douze « approved » : les poser
 * un par un demandait trente ouvertures de fenêtre. La décision porte sur la **version**,
 * pas sur le média — deux médias d'une même version reçoivent donc la même, une fois.
 *
 * Le serveur revérifie projet par projet (supervision effective, vocabulaire offert) et
 * répond ce qu'il a fait : une sélection qui traverse un projet où l'on n'est pas
 * superviseur aboutit en partie, et le dit.
 */
export default function BulkDecisionDialog({
  versionIds,
  projectId,
  open,
  onOpenChange,
  onDone,
}: {
  versionIds: number[];
  /** Projet commun de la sélection, s'il est unique : restreint le vocabulaire proposé. */
  projectId: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const theme = useTheme((s) => s.theme);
  const { data: statuses = [] } = useReviewStatusesQuery(open, projectId ?? undefined);
  const [statusId, setStatusId] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (statusId === null) return;
    setSaving(true);
    try {
      const { updated, failed } = await api.patch<{ updated: number; failed: number }>(
        '/api/bulk/versions/decision',
        {
          ids: versionIds,
          statusId,
          ...(comment.trim() ? { comment: comment.trim() } : {}),
        },
      );
      if (failed > 0) toast.warning(t('bulk.decision.partial', { count: updated, failed }));
      else toast.success(t('bulk.decision.done', { count: updated }));
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['reviews'] }),
        qc.invalidateQueries({ queryKey: ['versions'] }),
      ]);
      setComment('');
      setStatusId(null);
      onDone();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('decision.notSaved'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('bulk.decision.title', { count: versionIds.length })}</DialogTitle>
          {/* Sans projet commun, la liste est celle du studio : le serveur refusera un
              statut qu'un des projets ne connaît pas, et le comptera dans les refus. */}
          <DialogDescription>
            {projectId === null ? t('bulk.decision.mixed') : t('bulk.decision.hint')}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-1.5">
          {statuses.map((s: ReviewStatus) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setStatusId(s.id)}
              className={`rounded-md border px-2 py-1 text-xs transition-colors ${
                statusId === s.id ? 'ring-1 ring-ring' : 'opacity-70 hover:opacity-100'
              }`}
              style={reviewStatusStyle(s.color, theme === 'dark', statusId === s.id)}
            >
              {s.name}
            </button>
          ))}
        </div>

        <Textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder={t('decision.comment.placeholder')}
          aria-label={t('decision.comment.placeholder')}
          rows={2}
        />

        <DialogFooter>
          <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => void submit()}
            disabled={saving || statusId === null}
          >
            {t('decision.set')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
