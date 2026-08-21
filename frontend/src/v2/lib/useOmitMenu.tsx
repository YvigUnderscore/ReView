// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { EyeOff } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/apiClient';
import { qk } from './query';
import { useT } from '../i18n';
import type { MenuEntry } from './menuSpec';
import { isOmitted, omitBody, sequenceIdOf, type OmitTarget } from './omitMenu';

/**
 * Entrée « omis du montage » pour n'importe quel menu contextuel.
 *
 * Un plan coupé au montage garde ses tâches, ses versions, ses médias et ses commentaires
 * — c'est tout ce qui le distingue d'une suppression. La décision se prenait pourtant à
 * la main sur l'API : aucun écran ne l'offrait. Elle tient désormais dans une case à
 * cocher du clic droit, sur une carte de plan comme sur la page du plan.
 */
export function useOmitMenu(projectId: number) {
  const t = useT();
  const qc = useQueryClient();

  const toggle = async (shot: OmitTarget) => {
    const body = omitBody(shot);
    try {
      await api.patch(`/api/shots/${shot.id}`, body);
      // Ce que l'omission ne détruit pas mérite d'être dit : c'est la question que se pose
      // qui hésite à couper un plan plutôt qu'à le supprimer.
      if (body.omitted) toast.success(t('shot.omitted'), { description: t('shot.omittedHint') });
      else toast.success(t('shots.updated'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error.generic'));
    } finally {
      // Le serveur n'émet que `timeline:update` (les montages se refont seuls) : les
      // écrans qui montrent le plan, eux, ne l'apprendraient jamais.
      void qc.invalidateQueries({ queryKey: qk.shot(shot.id) });
      void qc.invalidateQueries({ queryKey: qk.shots(projectId) });
      const sequenceId = sequenceIdOf(shot);
      if (sequenceId != null) void qc.invalidateQueries({ queryKey: qk.sequence(sequenceId) });
    }
  };

  const entry = (shot: OmitTarget, options: { canEdit?: boolean } = {}): MenuEntry | null => {
    if (options.canEdit === false) return null;
    return {
      kind: 'checkbox',
      id: 'omitted',
      label: t('shot.omitted'),
      icon: <EyeOff size={14} />,
      checked: isOmitted(shot),
      onCheckedChange: () => void toggle(shot),
    };
  };

  return { entry, toggle };
}
