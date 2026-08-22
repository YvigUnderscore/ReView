// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { Button } from '../../components/ui/button';
import { SkeletonRows } from '../../components/ui/skeleton';
import { Panel } from './AdminPrimitives';
import { intlLocale, useT, type MessageKey, type Tr } from '../../i18n';
import {
  DEAD_ONLY_FAMILIES,
  MAX_BATCH,
  MAX_DAYS,
  MIN_BATCH,
  RETENTION_FAMILIES,
  clampBatchSize,
  clampDays,
  type RetentionFamily,
  type RetentionPolicy,
} from './retentionForm';

/**
 * Rétention des journaux (`lib/retention` côté serveur) : combien de temps le studio garde
 * chaque trace avant suppression automatique. C'est la page qu'on ouvre pour répondre à une
 * demande RGPD — d'où l'affichage systématique de la valeur par défaut du produit à côté de
 * la valeur en vigueur.
 */

/** Libellé traduit — table recalculée à chaque rendu, jamais figée au chargement du module. */
const familyLabel = (t: Tr, f: RetentionFamily) => t(`retention.family.${f}` as MessageKey);

interface Loaded {
  policy: RetentionPolicy;
  defaults: RetentionPolicy;
}

/** Une famille = une durée en jours. `0` conserve indéfiniment, et le dit. */
function DaysRow({
  family,
  value,
  fallback,
  onChange,
}: {
  family: RetentionFamily;
  value: number;
  fallback: number;
  onChange: (days: number) => void;
}) {
  const t = useT();
  const inputId = `retention-${family}`;
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border/50 py-1.5 text-sm last:border-0">
      <label className="w-56 shrink-0 text-muted-foreground" htmlFor={inputId}>
        {familyLabel(t, family)}
      </label>
      <input
        id={inputId}
        type="number"
        min={0}
        max={MAX_DAYS}
        value={value}
        onChange={(e) => onChange(clampDays(e.target.value))}
        className="w-20 rounded border border-input bg-background px-2 py-1 text-sm"
      />
      <span className="w-40 text-xs text-muted-foreground">
        {value === 0 ? t('retention.forever') : t('retention.defaultValue', { days: fallback })}
      </span>
      <span className="min-w-0 flex-1 text-xs text-muted-foreground">
        {t(DEAD_ONLY_FAMILIES.has(family) ? 'retention.hint.deadOnly' : 'retention.hint.byAge')}
      </span>
    </div>
  );
}

export default function RetentionTab() {
  const t = useT();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: qk.admin('retention'),
    queryFn: () => api.get<Loaded>('/api/admin/retention'),
  });
  const [draft, setDraft] = useState<RetentionPolicy | null>(null);
  const [busy, setBusy] = useState(false);
  if (data && !draft) setDraft(data.policy);

  if (isLoading || !data || !draft) return <SkeletonRows count={6} />;
  const defaults = data.defaults;

  const save = async () => {
    setBusy(true);
    try {
      const { policy } = await api.put<Loaded>('/api/admin/retention', draft);
      setDraft(policy);
      void qc.invalidateQueries({ queryKey: qk.admin('retention') });
      toast.success(t('retention.saved'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error.save'));
    } finally {
      setBusy(false);
    }
  };

  const run = async () => {
    setBusy(true);
    try {
      const res = await api.post<{ total: number; truncated: boolean }>('/api/admin/retention/run');
      toast.success(t('retention.runDone', { value: res.total.toLocaleString(intlLocale()) }));
      if (res.truncated) toast.info(t('retention.runTruncated'));
      void qc.invalidateQueries({ queryKey: qk.admin('audit') });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error.generic'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Panel title={t('retention.title')}>
        <p className="mb-2 text-xs text-muted-foreground">{t('retention.intro')}</p>
        <div>
          {RETENTION_FAMILIES.map((f) => (
            <DaysRow
              key={f}
              family={f}
              value={draft[f]}
              fallback={defaults[f]}
              onChange={(days) => setDraft({ ...draft, [f]: days })}
            />
          ))}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{t('retention.conflictNote')}</p>
      </Panel>

      <Panel title={t('retention.batchTitle')}>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label className="w-56 shrink-0 text-muted-foreground" htmlFor="retention-batch">
            {t('retention.batchSize')}
          </label>
          <input
            id="retention-batch"
            type="number"
            min={MIN_BATCH}
            max={MAX_BATCH}
            value={draft.batchSize}
            onChange={(e) => setDraft({ ...draft, batchSize: clampBatchSize(e.target.value) })}
            className="w-24 rounded border border-input bg-background px-2 py-1 text-sm"
          />
          <span className="min-w-0 flex-1 text-xs text-muted-foreground">
            {t('retention.hint.batchSize')}
          </span>
        </div>
      </Panel>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => void save()} disabled={busy}>
          {t('common.save')}
        </Button>
        <Button size="sm" variant="outline" onClick={() => void run()} disabled={busy}>
          {busy ? t('retention.running') : t('retention.run')}
        </Button>
      </div>
    </div>
  );
}
