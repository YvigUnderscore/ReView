// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { useT } from '../../i18n';
import type { StudioRow } from '../../types/api';
import type { SizeUnit } from './adminShared';
import {
  fieldDisplay,
  fieldsFor,
  isDirty,
  settingsPayload,
  type SettingField,
  type SettingsDraft,
  type SettingsHome,
  type SettingsUnits,
} from './studioSettings';

/**
 * The studio row (`/api/studio`): its name and its Discord webhook.
 *
 * Neither had a screen; they now have two, separate. A single
 * request and a single cache key serve them — two `useQuery` calls on the same route with
 * different types would eventually have diverged.
 */
export function useStudioRow() {
  return useQuery({
    queryKey: qk.admin('studio'),
    queryFn: () => api.get<{ studio: StudioRow }>('/api/studio').then((d) => d.studio),
  });
}

/**
 * The draft of the key/value settings of an admin screen.
 *
 * Eleven "Save" buttons on one screen were eleven chances to forget the one
 * not pressed. A screen now holds **one** draft, and its single action bar
 * only sends the keys actually touched — two administrators setting two neighbouring
 * fields therefore do not overwrite each other.
 *
 * Bespoke fields (language, accent, task policy, studio name) put their
 * value into the same draft: they share the bar instead of adding one.
 */
export function useStudioSettings(home: SettingsHome) {
  const t = useT();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: qk.admin('settings'),
    queryFn: () =>
      api.get<{ settings: Record<string, string> }>('/api/studio/settings').then((d) => d.settings),
  });
  const [draft, setDraft] = useState<SettingsDraft>({});
  const [units, setUnits] = useState<SettingsUnits>({});

  const stored = query.data ?? {};
  const fields = fieldsFor(home);

  const setValue = (key: string, value: string) => setDraft((d) => ({ ...d, [key]: value }));

  /** Changing the unit changes the value sent: it is therefore a change in its own right. */
  const setUnit = (field: SettingField, unit: SizeUnit) => {
    setUnits((u) => ({ ...u, [field.key]: unit }));
    setDraft((d) => ({ ...d, [field.key]: fieldDisplay(field, stored, d) }));
  };

  const discard = () => {
    setDraft({});
    setUnits({});
  };

  /**
   * Pushes the touched keys. Throws rather than writing half-way: the caller often chains
   * other saves under the same bar, and a half state would be worse than a
   * readable refusal.
   */
  const commit = async () => {
    const { entries, invalidKey } = settingsPayload(fields, draft, units);
    if (invalidKey) throw new Error(t('settings.invalidNumber'));
    for (const entry of entries) await api.put('/api/studio/settings', entry);
    if (entries.length > 0) await qc.invalidateQueries({ queryKey: qk.admin('settings') });
    discard();
  };

  return { query, stored, fields, draft, units, setValue, setUnit, discard, commit, dirty: isDirty(draft) };
}

/**
 * The action of a save bar: a single call in flight, one message per result.
 * Success is announced once, whatever the number of routes the page had to
 * call to honour its single button.
 */
export function useSaveAction(run: () => Promise<void>, successMessage?: string) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await run();
      toast.success(successMessage ?? t('settings.savedTick'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('common.error.save'));
    } finally {
      setBusy(false);
    }
  };
  return { busy, save };
}
