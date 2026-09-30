// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { NO_STATUS, statusChoices } from '../../lib/statusMenu';
import { usePipelineStatuses } from '../../lib/shotgridApi';
import { useT } from '../../i18n';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';

/**
 * Statut d'une sélection de plans.
 *
 * La barre de sélection n'offrait que « Assigner » et « Supprimer », quand le clic droit sur
 * un seul plan en propose neuf — dont le statut, qui est précisément ce qu'une production
 * change en lot : trente plans passés en retake après une session de review.
 *
 * Le serveur applique le statut plan par plan, avec les mêmes garde-fous qu'au singulier.
 * Il peut donc en refuser une partie (verrou ShotGrid, projet archivé) : le retour le dit
 * plutôt que d'annoncer un succès complet.
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
  // Même source que le menu contextuel : le vocabulaire de CE projet, pas l'enum figé.
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
          {/* Le retrait du statut est proposé comme les autres : c'est une décision, pas un
              vide — un plan « sans statut » est une réponse en soi. */}
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
