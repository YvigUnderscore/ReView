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
 * Applies the same review decision to a selection of media.
 *
 * A dailies session ends with thirty "retake" and twelve "approved": setting them one by one
 * would have required thirty dialog openings. The decision applies to the **version**, not the
 * media — two media of the same version therefore receive it once.
 *
 * The server re-checks project by project (effective supervision, offered vocabulary) and reports
 * what it did: a selection spanning a project where we are not a supervisor succeeds partially,
 * and says so.
 */
export default function BulkDecisionDialog({
  versionIds,
  projectId,
  open,
  onOpenChange,
  onDone,
}: {
  versionIds: number[];
  /** Common project of the selection, if unique: restricts the offered vocabulary. */
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
          {/* Without a common project, the list is the studio's: the server will refuse a
              status that one of the projects does not know, and count it among the refusals. */}
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
