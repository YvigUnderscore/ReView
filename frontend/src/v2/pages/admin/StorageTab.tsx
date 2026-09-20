// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { Button } from '../../components/ui/button';
import { SkeletonRows } from '../../components/ui/skeleton';
import { QueryState } from '../../components/ui/query-state';
import { Metric, Panel } from './AdminPrimitives';
import { fmtBytes, fmtDateTime } from './adminShared';
import { CATEGORY_LABELS, DERIVED_LABELS, STUDIO_LABELS, sortedEntries } from './adminStorage';
import SaveBar from './SaveBar';
import SettingsFields from './SettingsFields';
import StorageMap from './StorageMap';
import { useSaveAction, useStudioSettings } from './useStudioSettings';
import type { AdminStorageReport, StorageAgg } from '../../types/api';
import { useT, type MessageKey } from '../../i18n';
import { Hint } from '../../components/ui/hint';

function AggBars({
  agg,
  labels,
  total,
}: {
  agg: Record<string, StorageAgg>;
  labels: Record<string, MessageKey>;
  total: number;
}) {
  const t = useT();
  const entries = sortedEntries(agg, labels, total);
  if (entries.length === 0) return <Hint>{t('storage.noObject')}</Hint>;
  return (
    <div className="space-y-2">
      {entries.map((e) => (
        <div key={e.key}>
          <div className="mb-0.5 flex items-center justify-between text-xs">
            <span className="min-w-0 truncate">{e.labelKey ? t(e.labelKey) : e.key}</span>
            <span className="shrink-0 text-muted-foreground">
              {t('storage.objShort', { count: e.count })} · {fmtBytes(e.bytes)} ({e.pct}%)
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
            <div className="h-full rounded-full bg-primary" style={{ width: `${e.pct}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Limites de téléversement et quotas — la contrepartie réglable de la carte ci-dessous.
 *
 * Taille maximale d'un fichier, quota par compte et nombre d'envois simultanés se
 * réglaient dans la section fourre-tout, à trois écrans de la page qui montre ce que le
 * bucket contient. C'est ici qu'on vient quand le stockage déborde, donc c'est ici qu'on
 * doit pouvoir le borner. Le quota fait autorité pour tous les comptes ; la fiche d'un
 * compte n'en donne qu'une surcharge individuelle.
 */
function LimitsPanel() {
  const t = useT();
  const settings = useStudioSettings('storage');
  const { busy, save } = useSaveAction(() => settings.commit());
  return (
    <>
      <Panel title={t('settings.group.uploads')}>
        <SettingsFields
          fields={settings.fields}
          stored={settings.stored}
          draft={settings.draft}
          units={settings.units}
          onChange={settings.setValue}
          onUnit={settings.setUnit}
        />
      </Panel>
      <SaveBar dirty={settings.dirty} busy={busy} onSave={() => void save()} onDiscard={settings.discard} />
    </>
  );
}

/** Cartographie du stockage MinIO : occupation réelle par convention de clé + guide. */
export default function StorageTab() {
  const t = useT();
  const reportQ = useQuery({
    queryKey: qk.adminStorage,
    queryFn: () => api.get<AdminStorageReport>('/api/admin/storage'),
    // Scan complet du bucket : on ne relance pas en arrière-plan à chaque focus.
    staleTime: 5 * 60_000,
  });

  // Les limites ne dépendent pas du scan du bucket : elles restent réglables même quand il
  // échoue — c'est précisément le moment où l'on vient baisser un quota.
  if (!reportQ.data) {
    return (
      <div className="space-y-6">
        <QueryState query={reportQ} skeleton={<SkeletonRows count={6} />} />
        <LimitsPanel />
      </div>
    );
  }
  const r = reportQ.data;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Hint>{t('storage.scannedAt', { date: fmtDateTime(r.generatedAt), count: r.totalObjects })}</Hint>
        <Button variant="outline" size="sm" disabled={reportQ.isFetching} onClick={() => reportQ.refetch()}>
          <RefreshCw size={13} className={reportQ.isFetching ? 'animate-spin' : ''} /> {t('common.rescan')}
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label={t('storage.totalUsage')} value={fmtBytes(r.totalBytes)} />
        <Metric label={t('storage.objects')} value={r.totalObjects} />
        <Metric
          label={t('storage.originals')}
          value={fmtBytes(r.categories.originals?.bytes ?? 0)}
          sub={t('storage.objectsCount', { count: r.categories.originals?.count ?? 0 })}
        />
        <Metric
          label={t('storage.derived')}
          value={fmtBytes(r.categories.derived?.bytes ?? 0)}
          sub={t('storage.objectsCount', { count: r.categories.derived?.count ?? 0 })}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title={t('storage.byLocation')}>
          <AggBars agg={r.categories} labels={CATEGORY_LABELS} total={r.totalBytes} />
        </Panel>
        <Panel title={t('storage.derivedDetail')}>
          <AggBars agg={r.derived} labels={DERIVED_LABELS} total={r.categories.derived?.bytes ?? 0} />
          {Object.keys(r.studio).length > 0 && (
            <div className="mt-4">
              <h4 className="mb-2 text-xs font-semibold section-label text-muted-foreground">
                {t('hdri.studioLibraries')}
              </h4>
              <AggBars agg={r.studio} labels={STUDIO_LABELS} total={r.categories.studio?.bytes ?? 0} />
            </div>
          )}
        </Panel>
      </div>

      <Panel title={t('storage.originalsByProject')}>
        <div className="space-y-1.5">
          {r.projects.map((p) => (
            <div key={p.slug} className="flex items-center justify-between gap-2 text-sm">
              <span className="min-w-0 truncate">
                {p.projectId ? (
                  <Link to={`/admin/projects/${p.projectId}`} className="font-medium hover:underline">
                    {p.name ?? p.slug}
                  </Link>
                ) : (
                  <span className="font-medium">{p.slug}</span>
                )}
                <span className="ml-1 text-xs text-muted-foreground">projects/{p.slug}/</span>
                {p.deleted && <span className="ml-1 text-xs text-destructive">{t('common.inTrash')}</span>}
                {!p.projectId && (
                  <span className="ml-1 text-xs text-destructive">{t('storage.orphanProject')}</span>
                )}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {t('storage.objShort', { count: p.objects })} · {fmtBytes(p.bytes)}
              </span>
            </div>
          ))}
          {r.projects.length === 0 && <Hint>{t('storage.noOriginal')}</Hint>}
        </div>
      </Panel>

      <StorageMap />

      <LimitsPanel />
    </div>
  );
}
