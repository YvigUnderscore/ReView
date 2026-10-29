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
 * "Omitted from the edit" entry for any context menu.
 *
 * A shot cut at mount keeps its tasks, versions, media and comments
 * — that is all that distinguishes it from a deletion. The decision used to be taken by
 * hand on the API: no screen offered it. It now lives in a checkbox on the
 * right click, on a shot card as on the shot page.
 */
export function useOmitMenu(projectId: number) {
  const t = useT();
  const qc = useQueryClient();

  const toggle = async (shot: OmitTarget) => {
    const body = omitBody(shot);
    try {
      await api.patch(`/api/shots/${shot.id}`, body);
      // What omission does not destroy deserves to be said: it is the question asked by
      // someone hesitating to cut a shot rather than delete it.
      if (body.omitted) toast.success(t('shot.omitted'), { description: t('shot.omittedHint') });
      else toast.success(t('shots.updated'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error.generic'));
    } finally {
      // The server only emits `timeline:update` (edits rebuild themselves): the
      // screens showing the shot would never find out.
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
