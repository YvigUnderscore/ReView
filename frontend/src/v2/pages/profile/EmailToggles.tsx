// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { useAuth } from '../../stores/useAuth';
import { useT } from '../../i18n';

/** Case à cocher générique branchée sur une clé booléenne de `preferences`. */
function PrefCheckbox({
  prefKey,
  label,
  onLabel,
  offLabel,
  enabled,
  loading,
}: {
  prefKey: string;
  label: string;
  onLabel: string;
  offLabel: string;
  enabled: boolean;
  loading: boolean;
}) {
  const qc = useQueryClient();
  const toggle = async () => {
    try {
      await api.patch('/api/users/me/preferences', { [prefKey]: !enabled });
      qc.invalidateQueries({ queryKey: qk.preferences });
      toast.success(!enabled ? onLabel : offLabel);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erreur');
    }
  };
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={enabled}
        disabled={loading}
        onChange={toggle}
        className="h-4 w-4 accent-primary"
      />
      {label}
    </label>
  );
}

/** Abonnement au digest quotidien par email (préférence `emailDigest`, backlog P2). */
export function DigestToggle() {
  const t = useT();
  const prefsQ = useQuery({
    queryKey: qk.preferences,
    queryFn: () =>
      api
        .get<{ preferences: { emailDigest?: boolean } }>('/api/users/me/preferences')
        .then((d) => d.preferences),
  });
  return (
    <PrefCheckbox
      prefKey="emailDigest"
      label={t('email.digest')}
      onLabel="Digest quotidien activé"
      offLabel="Digest quotidien désactivé"
      enabled={prefsQ.data?.emailDigest === true}
      loading={prefsQ.isLoading}
    />
  );
}

/** Rapport hebdomadaire de production (43.B — `weeklyReport`) : superviseurs/admins. */
export function WeeklyReportToggle() {
  const t = useT();
  const role = useAuth((s) => s.user?.role);
  const canReceive = role === 'ADMIN' || role === 'SUPERVISOR';
  const prefsQ = useQuery({
    queryKey: qk.preferences,
    queryFn: () =>
      api
        .get<{ preferences: { weeklyReport?: boolean } }>('/api/users/me/preferences')
        .then((d) => d.preferences),
    enabled: canReceive,
  });
  if (!canReceive) return null;
  return (
    <PrefCheckbox
      prefKey="weeklyReport"
      label={t('email.weekly')}
      onLabel="Rapport hebdomadaire activé"
      offLabel="Rapport hebdomadaire désactivé"
      enabled={prefsQ.data?.weeklyReport === true}
      loading={prefsQ.isLoading}
    />
  );
}
