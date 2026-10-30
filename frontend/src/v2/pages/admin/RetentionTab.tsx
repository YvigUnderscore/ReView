// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/apiClient';
import { qk } from '../../lib/query';
import { Button } from '../../components/ui/button';
import { SkeletonRows } from '../../components/ui/skeleton';
import { QueryState } from '../../components/ui/query-state';
import { Panel } from './AdminPrimitives';
import SaveBar from './SaveBar';
import SettingsFields from './SettingsFields';
import { useSaveAction, useStudioSettings } from './useStudioSettings';
import { intlLocale, useT, type MessageKey, type Tr } from '../../i18n';
import {
  DEAD_ONLY_FAMILIES,
  MAX_BATCH,
  MAX_DAYS,
  MIN_BATCH,
  RETENTION_FAMILIES,
  clampBatchSize,
  clampDays,
  policyChanged,
  type RetentionFamily,
  type RetentionPolicy,
} from './retentionForm';
import { Hint } from '../../components/ui/hint';

/**
 * Retention: how long the studio keeps what it has produced and what it has deleted,
 * before automatic purge. This is the page one opens to answer a GDPR request —
 * hence the systematic display of the product default next to the one in
 * force.
 *
 * The trash used to empty according to a delay set in the catch-all section, at the other end
 * of the sidebar: two screens to know for a single question. The trash delay
 * lives here, with the logs; the "Trash" screen links back to it.
 */

/** Translated label — table recomputed on each render, never frozen at module load. */
const familyLabel = (t: Tr, f: RetentionFamily) => t(`retention.family.${f}` as MessageKey);

interface Loaded {
  policy: RetentionPolicy;
  defaults: RetentionPolicy;
}

/** A family = a duration in days. `0` keeps indefinitely, and says so. */
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
  const retentionQ = useQuery({
    queryKey: qk.admin('retention'),
    queryFn: () => api.get<Loaded>('/api/admin/retention'),
  });
  const data = retentionQ.data;
  const settings = useStudioSettings('retention');
  const [draft, setDraft] = useState<RetentionPolicy | null>(null);
  const [sweeping, setSweeping] = useState(false);

  /**
   * A single bar for two routes: the logs policy (`/api/admin/retention`)
   * and the trash delay (a key/value setting). Nothing on screen says these are
   * two different stores — and nothing should.
   */
  const { busy, save } = useSaveAction(async () => {
    if (draft && data && policyChanged(data.policy, draft)) {
      const { policy } = await api.put<Loaded>('/api/admin/retention', draft);
      setDraft(policy);
      await qc.invalidateQueries({ queryKey: qk.admin('retention') });
    }
    await settings.commit();
  }, t('retention.saved'));

  if (data && !draft) setDraft(data.policy);

  if (!data || !draft) return <QueryState query={retentionQ} skeleton={<SkeletonRows count={6} />} />;
  const defaults = data.defaults;
  const dirty = policyChanged(data.policy, draft) || settings.dirty;

  const discard = () => {
    setDraft(data.policy);
    settings.discard();
  };

  const run = async () => {
    setSweeping(true);
    try {
      const res = await api.post<{ total: number; truncated: boolean }>('/api/admin/retention/run');
      toast.success(t('retention.runDone', { value: res.total.toLocaleString(intlLocale()) }));
      if (res.truncated) toast.info(t('retention.runTruncated'));
      void qc.invalidateQueries({ queryKey: qk.admin('audit') });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error.generic'));
    } finally {
      setSweeping(false);
    }
  };

  return (
    <div>
      <div className="space-y-4">
        <Panel title={t('settings.group.data')}>
          <SettingsFields
            fields={settings.fields}
            stored={settings.stored}
            draft={settings.draft}
            units={settings.units}
            onChange={settings.setValue}
            onUnit={settings.setUnit}
          />
        </Panel>

        <Panel title={t('retention.title')}>
          <Hint>{t('retention.intro')}</Hint>
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
          <Hint>{t('retention.conflictNote')}</Hint>
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

        {/* Sweeping now is not a save: it is an operation, which stays
          beside the settings it applies rather than in the bar that validates them. */}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => void run()} disabled={busy || sweeping}>
            {sweeping ? t('retention.running') : t('retention.run')}
          </Button>
        </div>
      </div>

      <SaveBar dirty={dirty} busy={busy} onSave={() => void save()} onDiscard={discard} />
    </div>
  );
}
