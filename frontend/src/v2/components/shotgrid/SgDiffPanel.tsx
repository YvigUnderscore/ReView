// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { AlertTriangle, ArrowRight, ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { useT } from '../../i18n';
import { intlLocale } from '../../i18n';
import { useRunSync, useSgDiff } from '../../lib/shotgridApi';
import type { SgConnection, SgDiffEntry } from '../../types/shotgrid';

/**
 * Comparaison ReView ↔ ShotGrid.
 *
 * Après une coupure, une mise à jour ou un webhook perdu, le miroir peut avoir dérivé
 * sans que rien ne le signale. Cet écran relit les deux côtés et énumère les écarts —
 * sans rien corriger. Le réalignement est un geste séparé, parce qu'écraser du travail
 * mérite d'être décidé plutôt que subi.
 */
export default function SgDiffPanel({
  connection,
  canManage,
}: {
  connection: SgConnection;
  canManage: boolean;
}) {
  const t = useT();
  const [enabled, setEnabled] = useState(false);
  const { data, isLoading, refetch, isFetching } = useSgDiff(connection.projectId, enabled);
  const runSync = useRunSync(connection.projectId);
  const [filter, setFilter] = useState<string>('');

  const realign = async () => {
    try {
      await runSync.mutateAsync({ kind: 'full' });
      toast.success(t('shotgrid.diff.realigned'));
      await refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('shotgrid.sync.failed'));
    }
  };

  if (!enabled)
    return (
      <div className="rounded-md border border-border p-4 text-center">
        <p className="mb-3 text-sm text-muted-foreground">{t('shotgrid.diff.intro')}</p>
        <button
          type="button"
          onClick={() => setEnabled(true)}
          className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:opacity-90"
        >
          {t('shotgrid.diff.compare')}
        </button>
      </div>
    );

  if (isLoading)
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="animate-spin" size={14} /> {t('shotgrid.diff.loading')}
      </p>
    );

  if (!data) return <p className="text-sm text-destructive">{t('shotgrid.diff.failed')}</p>;

  const entries = filter ? data.entries.filter((e) => e.kind === filter) : data.entries;

  return (
    <div className="space-y-4">
      {!data.projectNameOk && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
          <p className="flex items-center gap-1.5 font-medium">
            <AlertTriangle size={14} /> {t('shotgrid.diff.nameMismatch')}
          </p>
          <p className="mt-1 text-xs">
            {t('shotgrid.diff.nameMismatchDetail', {
              expected: data.sgProjectName,
              found: data.remoteProjectName ?? '—',
            })}
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {Object.entries(data.counts).map(([entity, c]) => {
          const gap = c.shotgrid - c.review;
          return (
            <div key={entity} className="rounded-md border border-border p-2 text-center">
              <div className="text-xs text-muted-foreground">{t(`shotgrid.entity.${entity}` as never)}</div>
              <div className="text-sm font-medium">
                {c.review} / {c.shotgrid}
              </div>
              {gap !== 0 && (
                <div className={gap > 0 ? 'text-xs text-warning' : 'text-xs text-info'}>
                  {gap > 0 ? `+${gap}` : gap}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-secondary/60"
        >
          {isFetching ? <Loader2 className="animate-spin" size={14} /> : <RefreshCw size={14} />}
          {t('shotgrid.diff.refresh')}
        </button>
        {canManage && data.entries.length > 0 && (
          <button
            type="button"
            onClick={realign}
            disabled={runSync.isPending}
            className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:opacity-90"
            title={t('shotgrid.diff.realignHint')}
          >
            {runSync.isPending ? <Loader2 className="animate-spin" size={14} /> : <ArrowRight size={14} />}
            {t('shotgrid.diff.realign')}
          </button>
        )}
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="rounded-md border border-border bg-background px-2 py-1 text-sm"
        >
          <option value="">{t('shotgrid.diff.allKinds')}</option>
          <option value="missing_local">{t('shotgrid.diff.missingLocal')}</option>
          <option value="missing_remote">{t('shotgrid.diff.missingRemote')}</option>
          <option value="field_differs">{t('shotgrid.diff.fieldDiffers')}</option>
          <option value="unlinked">{t('shotgrid.diff.unlinked')}</option>
        </select>
        <span className="text-xs text-muted-foreground">
          {t('shotgrid.diff.generatedAt', {
            date: new Date(data.generatedAt).toLocaleString(intlLocale()),
          })}
        </span>
      </div>

      {entries.length === 0 ? (
        <p className="rounded-md border border-success/40 bg-success/10 p-3 text-sm">
          {t('shotgrid.diff.noGap')}
        </p>
      ) : (
        <div className="overflow-hidden rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="bg-secondary/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">{t('shotgrid.diff.kind')}</th>
                <th className="px-3 py-2 text-left font-medium">{t('shotgrid.diff.entity')}</th>
                <th className="px-3 py-2 text-left font-medium">{t('shotgrid.diff.name')}</th>
                <th className="px-3 py-2 text-left font-medium">{t('shotgrid.diff.detail')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {entries.map((entry, i) => (
                <DiffRow key={`${entry.entity}-${entry.sgId ?? entry.localId}-${i}`} entry={entry} />
              ))}
            </tbody>
          </table>
          {data.truncated && (
            <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
              {t('shotgrid.diff.truncated')}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function DiffRow({ entry }: { entry: SgDiffEntry }) {
  const t = useT();
  const tone =
    entry.kind === 'missing_local'
      ? 'text-warning'
      : entry.kind === 'missing_remote'
        ? 'text-info'
        : entry.kind === 'unlinked'
          ? 'text-muted-foreground'
          : 'text-accent2';

  return (
    <tr>
      <td className={`px-3 py-2 text-xs ${tone}`}>{t(`shotgrid.diff.${entry.kind}` as never)}</td>
      <td className="px-3 py-2 text-xs">{t(`shotgrid.entity.${entry.entity}` as never)}</td>
      <td className="px-3 py-2">
        {entry.sgUrl ? (
          <a
            href={entry.sgUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 hover:underline"
          >
            {entry.name} <ExternalLink size={11} />
          </a>
        ) : (
          entry.name
        )}
      </td>
      <td className="px-3 py-2 text-xs text-muted-foreground">
        {entry.fields?.map((f) => (
          <div key={f.field}>
            <span className="font-medium">{f.field}</span> : {f.review ?? '—'} → {f.shotgrid ?? '—'}
          </div>
        ))}
      </td>
    </tr>
  );
}
