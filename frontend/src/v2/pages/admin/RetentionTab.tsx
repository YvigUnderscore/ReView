// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
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
 * Rétention : combien de temps le studio garde ce qu'il a produit et ce qu'il a supprimé,
 * avant purge automatique. C'est la page qu'on ouvre pour répondre à une demande RGPD —
 * d'où l'affichage systématique de la valeur par défaut du produit à côté de celle en
 * vigueur.
 *
 * La corbeille se vidait selon un délai réglé dans la section fourre-tout, à l'autre bout
 * de la barre latérale : deux écrans à connaître pour une seule question. Le délai de la
 * corbeille vit ici, avec les journaux ; l'écran « Corbeille » y renvoie.
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
  const retentionQ = useQuery({
    queryKey: qk.admin('retention'),
    queryFn: () => api.get<Loaded>('/api/admin/retention'),
  });
  const data = retentionQ.data;
  const settings = useStudioSettings('retention');
  const [draft, setDraft] = useState<RetentionPolicy | null>(null);
  const [sweeping, setSweeping] = useState(false);

  /**
   * Une seule barre pour deux routes : la politique des journaux (`/api/admin/retention`)
   * et le délai de la corbeille (un réglage clé/valeur). Rien à l'écran ne dit qu'il s'agit
   * de deux stockages différents — et rien ne devrait le dire.
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

        {/* Balayer maintenant n'est pas un enregistrement : c'est une opération, qui reste à
          côté des réglages qu'elle applique plutôt que dans la barre qui les valide. */}
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
