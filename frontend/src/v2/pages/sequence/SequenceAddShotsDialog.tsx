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

/** Les deux gestes, jamais fondus l'un dans l'autre : on crée, ou on rattache. */
export type AddShotsMode = 'create' | 'attach';

/** Nomenclature de repli tant que les réglages du projet ne sont pas arrivés. */
const FALLBACK = { prefix: 'SH', step: 10, padding: 3 };

/**
 * Ajouter des plans à la séquence ouverte.
 *
 * Depuis une séquence, la destination n'est plus une question : c'est celle qu'on regarde.
 * Le générateur est donc celui de l'onglet Plans, privé de son sélecteur de séquence —
 * réécrire un second formulaire de création aurait garanti qu'ils divergent.
 *
 * Une seule porte d'entrée pour deux gestes distincts (UI simple) : la bascule les nomme
 * plutôt que de laisser deux boutons se disputer le coin de l'écran.
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
  /** Projet piloté par ShotGrid : créer un plan ici serait refusé par le serveur. */
  createLocked: boolean;
  mode: AddShotsMode;
  onModeChange: (mode: AddShotsMode) => void;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  // La nomenclature du projet préremplit le générateur, comme dans l'onglet Plans : un
  // studio qui numérote en PL0010 ne doit pas retaper son préfixe à chaque séquence.
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
      // La destination est la séquence ouverte — d'où l'absence de sélecteur.
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
