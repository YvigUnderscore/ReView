// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/apiClient';
import { NO_STATUS, statusChoices } from '../../lib/statusMenu';
import { usePipelineStatuses } from '../../lib/shotgridApi';
import { useT } from '../../i18n';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';

/**
 * Status of a selection of shots.
 *
 * The selection bar only offered "Assign" and "Delete", whereas right-clicking a single shot offers nine
 * options, including its status: exactly what a production changes in bulk, e.g. thirty shots moved to
 * retake after a review session.
 *
 * The server applies the status shot by shot, with the same safeguards as for a single one. It can
 * therefore refuse some of them (ShotGrid lock, archived project): the result says so rather than
 * announcing full success.
 */
export default function BulkStatusDialog({
  projectId,
  ids,
  onClose,
  onDone,
}: {
  projectId: number;
  ids: number[];
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useT();
  // Same source as the context menu: the vocabulary of THIS project, not the frozen enum.
  const { data: statuses = [] } = usePipelineStatuses('shot', projectId);
  const choices = statusChoices(statuses, 'shot', t);
  const [value, setValue] = useState<string>('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!value) return;
    setBusy(true);
    try {
      const { updated, failed } = await api.patch<{ updated: number; failed: number }>(
        '/api/bulk/shots/status',
        {
          ids,
          pipelineStatusId: value === NO_STATUS ? null : Number(value),
        },
      );
      if (failed > 0) toast.warning(t('bulk.status.partial', { count: updated, failed }));
      else toast.success(t('bulk.status.done', { count: updated }));
      onDone();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('pipeline.status.changeFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('bulk.status.title', { count: ids.length })}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-1">
          {/* Clearing the status is offered like the others: it is a decision, not an absence, since
              a shot "without status" is an answer in itself. */}
          <button
            type="button"
            onClick={() => setValue(NO_STATUS)}
            className={`flex items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-secondary ${
              value === NO_STATUS ? 'bg-secondary' : ''
            }`}
          >
            <span className="h-2.5 w-2.5 shrink-0 rounded-full border border-border" />
            {t('pipeline.status.none')}
          </button>
          {choices.map((choice) => (
            <button
              key={choice.value}
              type="button"
              onClick={() => setValue(choice.value)}
              className={`flex items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-secondary ${
                value === choice.value ? 'bg-secondary' : ''
              }`}
            >
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: choice.color ?? 'transparent' }}
              />
              {choice.label}
            </button>
          ))}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="button" size="sm" onClick={() => void submit()} disabled={busy || !value}>
            {t('common.apply')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
