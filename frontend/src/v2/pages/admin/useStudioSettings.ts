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
 * La ligne du studio (`/api/studio`) : son nom et son webhook Discord.
 *
 * Ni l'un ni l'autre n'avait d'écran ; ils en ont désormais deux, distincts. Une seule
 * requête et une seule clé de cache les servent — deux `useQuery` sur la même route avec
 * des types différents auraient fini par diverger.
 */
export function useStudioRow() {
  return useQuery({
    queryKey: qk.admin('studio'),
    queryFn: () => api.get<{ studio: StudioRow }>('/api/studio').then((d) => d.studio),
  });
}

/**
 * Le brouillon des réglages clé/valeur d'un écran d'administration.
 *
 * Onze boutons « Enregistrer » sur un même écran, c'étaient onze occasions d'oublier celui
 * qu'on n'avait pas pressé. Un écran tient désormais **un** brouillon, et sa barre d'action
 * unique n'envoie que les clés réellement touchées — deux administrateurs qui règlent deux
 * champs voisins ne s'écrasent donc pas l'un l'autre.
 *
 * Les champs sur mesure (langue, accent, politique de tâches, nom du studio) déposent leur
 * valeur dans le même brouillon : ils partagent la barre au lieu d'en ajouter une.
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

  /** Changer d'unité change la valeur envoyée : c'est donc une modification à part entière. */
  const setUnit = (field: SettingField, unit: SizeUnit) => {
    setUnits((u) => ({ ...u, [field.key]: unit }));
    setDraft((d) => ({ ...d, [field.key]: fieldDisplay(field, stored, d) }));
  };

  const discard = () => {
    setDraft({});
    setUnits({});
  };

  /**
   * Pousse les clés touchées. Lève plutôt que d'écrire à moitié : l'appelant enchaîne
   * souvent d'autres enregistrements sous la même barre, et un demi-état serait pire qu'un
   * refus lisible.
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
 * L'action d'une barre d'enregistrement : un seul appel en vol, un message par résultat.
 * Le succès est annoncé une fois, quel que soit le nombre de routes que la page a dû
 * appeler pour honorer son bouton unique.
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
