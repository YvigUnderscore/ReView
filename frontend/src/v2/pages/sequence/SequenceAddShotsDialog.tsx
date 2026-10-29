// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import BatchGenerator from '../../components/BatchGenerator';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { SegmentedControl } from '../../components/ui/segmented-control';
import SequenceShotPicker from './SequenceShotPicker';
import type { ProjectSettings } from '../../types/api';
import { useT } from '../../i18n';

/** The two gestures, never blended into one: create, or attach. */
export type AddShotsMode = 'create' | 'attach';

/** Fallback naming scheme until the project settings have arrived. */
const FALLBACK = { prefix: 'SH', step: 10, padding: 3 };

/**
 * Adds shots to the open sequence.
 *
 * From within a sequence, the destination is no longer a question: it is the one being looked at.
 * The generator is therefore the Shots tab's, minus its sequence selector — rewriting a second
 * creation form would have guaranteed that the two diverge.
 *
 * A single entry point for two distinct gestures (simple UI): the toggle names them rather than
 * letting two buttons fight over the corner of the screen.
 */
export default function SequenceAddShotsDialog({
  projectId,
  sequenceId,
  canManage,
  createLocked,
  mode,
  onModeChange,
  onClose,
  onDone,
}: {
  projectId: number;
  sequenceId: number;
  canManage: boolean;
  /** Project driven by ShotGrid: creating a shot here would be refused by the server. */
  createLocked: boolean;
  mode: AddShotsMode;
  onModeChange: (mode: AddShotsMode) => void;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  // The project's naming scheme pre-fills the generator, as in the Shots tab: a studio that
  // numbers as PL0010 must not retype its prefix for every sequence.
  const { data: settings } = useQuery({
    queryKey: qk.projectSettings(projectId),
    queryFn: () =>
      api.get<{ settings: ProjectSettings }>(`/api/projects/${projectId}/settings`).then((d) => d.settings),
    enabled: projectId > 0,
  });
  const nomenclature = settings?.nomenclature;

  const createShots = async (items: { code: string; name: string }[]) => {
    await api.post('/api/shots/bulk', {
      projectId,
      // The destination is the open sequence — hence no selector.
      items: items.map((it) => ({ code: it.code, name: it.name, sequenceId })),
    });
    toast.success(t('shots.created', { count: items.length }));
    await Promise.all([
      qc.invalidateQueries({ queryKey: qk.sequence(sequenceId) }),
      qc.invalidateQueries({ queryKey: qk.shots(projectId) }),
      qc.invalidateQueries({ queryKey: qk.sequences(projectId) }),
    ]);
    onDone();
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="flex max-h-[80vh] max-w-2xl flex-col">
        <DialogHeader>
          <DialogTitle>{t('sequenceShots.add')}</DialogTitle>
        </DialogHeader>
        <SegmentedControl
          label={t('sequenceShots.mode')}
          value={mode}
          onChange={onModeChange}
          className="mb-3 self-start"
          items={[
            {
              value: 'create',
              label: t('sequenceShots.create'),
              icon: Plus,
              disabled: createLocked,
              hint: createLocked ? t('shotgrid.locked.body') : undefined,
            },
            { value: 'attach', label: t('sequenceShots.attach'), icon: Link2 },
          ]}
        />
        {mode === 'create' ? (
          <div className="min-h-0 overflow-y-auto pr-1">
            <BatchGenerator
              defaults={{
                prefix: nomenclature?.shotPrefix ?? FALLBACK.prefix,
                step: nomenclature?.step ?? FALLBACK.step,
                padding: nomenclature?.padding ?? FALLBACK.padding,
              }}
              onSubmit={createShots}
            />
          </div>
        ) : (
          <SequenceShotPicker
            projectId={projectId}
            sequenceId={sequenceId}
            canManage={canManage}
            onDone={onDone}
            onCancel={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
