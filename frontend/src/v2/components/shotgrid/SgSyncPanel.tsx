// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { AlertTriangle, Check, History, Loader2, RefreshCw, X } from 'lucide-react';
import { toast } from 'sonner';
import { useT } from '../../i18n';
import { intlLocale } from '../../i18n';
import { useResolveConflict, useRunSync, useSgLogs, useSgRuns } from '../../lib/shotgridApi';
import type { SgConnection, SgSyncRun } from '../../types/shotgrid';
import { syncOutcome } from './syncOutcome';

/**
 * Exécutions de synchronisation : lancement, compteurs, journal détaillé et arbitrage
 * des conflits laissés en attente. Le journal enregistre des clés de message, traduites
 * ici : une synchronisation d'il y a six mois se relit dans la langue du lecteur.
 */

/**
 * Libellé du champ en litige. Le journal ne stocke qu'un identifiant : la table vit ici
 * pour qu'un conflit relu dans une autre langue se lise dans celle du lecteur.
 */
function fieldLabel(t: ReturnType<typeof useT>, field: string): string {
  if (field === 'status') return t('shotgrid.conflict.field.status');
  return field;
}

export default function SgSyncPanel({
  connection,
  canManage,
}: {
  connection: SgConnection;
  canManage: boolean;
}) {
  const t = useT();
  const { data, isLoading } = useSgRuns(connection.projectId);
  const runSync = useRunSync(connection.projectId);
  const resolve = useResolveConflict(connection.projectId);
  const [openRun, setOpenRun] = useState<number | null>(null);

  const launch = async (kind: 'full' | 'reconcile') => {
    try {
      const r = await runSync.mutateAsync({ kind });
      // Le choix du ton et du message vit dans `syncOutcome` : c'est la table qui
      // empêche « deferred » de repasser en vert, et elle se relit sans monter l'écran.
      const { tone, key } = syncOutcome(r.result?.status);
      toast[tone](t(key));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('shotgrid.sync.failed'));
    }
  };

  const conflicts = data?.openConflicts ?? [];
  // Les clés de libellé sont énumérées : le serveur ne nomme que ces cinq domaines, et
  // une chaîne libre venue de la base ne doit pas devenir une clé de traduction.
  const DOMAIN_LABELS = {
    tasks: 'shotgrid.domain.tasks',
    hierarchy: 'shotgrid.domain.hierarchy',
    versions: 'shotgrid.domain.versions',
    notes: 'shotgrid.domain.notes',
    playlists: 'shotgrid.domain.playlists',
  } as const;
  const blockedDomains = Object.entries(connection.pushBlocked ?? {})
    .filter(([domain, v]) => v.count > 0 && domain in DOMAIN_LABELS)
    .map(([domain]) => DOMAIN_LABELS[domain as keyof typeof DOMAIN_LABELS]);

  const applyResolution = async (logId: number, resolution: 'sg' | 'review') => {
    try {
      const { applied } = await resolve.mutateAsync({ logId, resolution });
      // « blocked » : la ligne se ferme mais rien n'est parti — l'écriture du domaine est
      // fermée dans les réglages. L'annoncer comme résolu laisserait l'écart revenir à
      // la prochaine synchronisation sans que personne comprenne pourquoi.
      if (applied.action === 'blocked') toast.warning(t('shotgrid.conflict.writeBlocked'));
      else toast.success(t('shotgrid.conflict.resolved'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('shotgrid.conflict.failed'));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => launch('full')}
          disabled={!canManage || runSync.isPending}
          className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {runSync.isPending ? <Loader2 className="animate-spin" size={14} /> : <RefreshCw size={14} />}
          {t('shotgrid.sync.runFull')}
        </button>
        <button
          type="button"
          onClick={() => launch('reconcile')}
          disabled={!canManage || runSync.isPending}
          className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-secondary/60 disabled:opacity-50"
          title={t('shotgrid.sync.reconcileHint')}
        >
          <History size={14} /> {t('shotgrid.sync.runReconcile')}
        </button>
        {connection.lastSyncAt && (
          <span className="text-xs text-muted-foreground">
            {t('shotgrid.sync.lastRun', {
              date: new Date(connection.lastSyncAt).toLocaleString(intlLocale()),
            })}
          </span>
        )}
      </div>

      {/* Un projet qui ne publie pas vers ShotGrid le fait en silence : la version se
          publie ici, rien ne part là-bas, et personne ne l'apprend avant de constater
          l'absence. Une connexion neuve naît dans cet état. */}
      {connection.settings?.push?.publishMode === 'off' && (
        <p className="flex items-center gap-1.5 rounded-md border border-warning/40 bg-warning/10 p-2.5 text-xs">
          <AlertTriangle size={13} className="shrink-0" />
          {t('shotgrid.sync.publishOff')}
        </p>
      )}

      {/* Écritures refusées par la matrice de droits. Le job de file se terminait « ok » :
          l'utilisateur voyait sa modification prise dans ReView et cherchait ensuite
          pourquoi le site ne bougeait pas. */}
      {blockedDomains.length > 0 && (
        <p className="flex items-start gap-1.5 rounded-md border border-warning/40 bg-warning/10 p-2.5 text-xs">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          <span>
            {t('shotgrid.sync.pushBlocked', {
              domains: blockedDomains.map((key) => t(key)).join(', '),
            })}
          </span>
        </p>
      )}

      {conflicts.length > 0 && (
        <div className="rounded-md border border-warning/40 bg-warning/10 p-3">
          <p className="mb-2 flex items-center gap-1.5 text-sm font-medium">
            <AlertTriangle size={14} /> {t('shotgrid.sync.conflicts', { count: conflicts.length })}
          </p>
          <ul className="space-y-1 text-xs">
            {conflicts.slice(0, 10).map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 flex-1">
                  <span className="font-medium">
                    {String(c.vars?.name ?? `${c.localType} #${c.localId}`)}
                  </span>
                  {/* Ce qui diverge, en toutes lettres : sans cela, « garder ShotGrid »
                      revient à trancher à l'aveugle. Les conflits enregistrés avant que
                      ces valeurs soient relevées le disent, plutôt que d'aligner des
                      tirets qu'on prendrait pour des valeurs vides. */}
                  <span className="block text-xs text-muted-foreground">
                    {c.vars?.field
                      ? t('shotgrid.conflict.detail', {
                          field: fieldLabel(t, String(c.vars.field)),
                          review: String(c.vars.review ?? '—'),
                          shotgrid: String(c.vars.shotgrid ?? '—'),
                        })
                      : t('shotgrid.conflict.noDetail')}
                  </span>
                </span>
                {canManage && (
                  <span className="flex gap-1">
                    <button
                      type="button"
                      disabled={resolve.isPending}
                      onClick={() => applyResolution(c.id, 'sg')}
                      className="rounded border border-border px-1.5 py-0.5 hover:bg-secondary disabled:opacity-50"
                    >
                      {t('shotgrid.sync.keepSg')}
                    </button>
                    <button
                      type="button"
                      disabled={resolve.isPending}
                      onClick={() => applyResolution(c.id, 'review')}
                      className="rounded border border-border px-1.5 py-0.5 hover:bg-secondary disabled:opacity-50"
                    >
                      {t('shotgrid.sync.keepReview')}
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {isLoading ? (
        <Loader2 className="animate-spin text-muted-foreground" size={16} />
      ) : (
        <div className="overflow-hidden rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="bg-secondary/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">{t('shotgrid.sync.when')}</th>
                <th className="px-3 py-2 text-left font-medium">{t('shotgrid.sync.kind')}</th>
                <th className="px-3 py-2 text-left font-medium">{t('shotgrid.sync.result')}</th>
                <th className="px-3 py-2 text-left font-medium">{t('shotgrid.sync.counts')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {(data?.runs ?? []).map((run) => (
                <RunRow
                  key={run.id}
                  run={run}
                  open={openRun === run.id}
                  onToggle={() => setOpenRun(openRun === run.id ? null : run.id)}
                />
              ))}
              {(data?.runs ?? []).length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-4 text-center text-sm text-muted-foreground">
                    {t('shotgrid.sync.noRun')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {openRun !== null && <RunLogs runId={openRun} />}
    </div>
  );
}

function RunRow({ run, open, onToggle }: { run: SgSyncRun; open: boolean; onToggle: () => void }) {
  const t = useT();
  const totals = Object.values(run.stats ?? {}).reduce(
    (acc, c) => ({
      created: acc.created + (c.created ?? 0),
      updated: acc.updated + (c.updated ?? 0),
      failed: acc.failed + (c.failed ?? 0),
    }),
    { created: 0, updated: 0, failed: 0 },
  );
  const icon =
    run.status === 'ok' ? (
      <Check size={13} className="text-success" />
    ) : run.status === 'error' ? (
      <X size={13} className="text-destructive" />
    ) : (
      <AlertTriangle size={13} className="text-warning" />
    );

  return (
    <tr className="cursor-pointer hover:bg-secondary/40" onClick={onToggle}>
      <td className="px-3 py-2 text-xs">{new Date(run.startedAt).toLocaleString(intlLocale())}</td>
      <td className="px-3 py-2 text-xs">{t(`shotgrid.kind.${run.kind}` as never)}</td>
      <td className="px-3 py-2">
        <span className="flex items-center gap-1.5 text-xs">
          {icon} {t(`shotgrid.status.${run.status}` as never)}
        </span>
      </td>
      <td className="px-3 py-2 text-xs text-muted-foreground">
        {t('shotgrid.sync.summary', {
          created: totals.created,
          updated: totals.updated,
          failed: totals.failed,
        })}
        {open ? ' ▾' : ' ▸'}
      </td>
    </tr>
  );
}

function RunLogs({ runId }: { runId: number }) {
  const t = useT();
  const [level, setLevel] = useState('');
  const { data, isLoading } = useSgLogs(runId, level);

  return (
    <div className="rounded-md border border-border">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <span className="text-xs font-medium">{t('shotgrid.sync.logTitle')}</span>
        <select
          value={level}
          onChange={(e) => setLevel(e.target.value)}
          className="rounded border border-border bg-background px-2 py-0.5 text-xs"
        >
          <option value="">{t('shotgrid.sync.allLevels')}</option>
          <option value="info">{t('shotgrid.level.info')}</option>
          <option value="warn">{t('shotgrid.level.warn')}</option>
          <option value="error">{t('shotgrid.level.error')}</option>
          <option value="conflict">{t('shotgrid.level.conflict')}</option>
        </select>
        {data && <span className="text-xs text-muted-foreground">{data.total}</span>}
      </div>
      <div className="max-h-64 overflow-auto">
        {isLoading ? (
          <Loader2 className="m-3 animate-spin text-muted-foreground" size={14} />
        ) : (
          <ul className="divide-y divide-border text-xs">
            {(data?.items ?? []).map((log) => (
              <li key={log.id} className="flex gap-2 px-3 py-1.5">
                <span
                  className={
                    log.level === 'error'
                      ? 'text-destructive'
                      : log.level === 'warn'
                        ? 'text-warning'
                        : log.level === 'conflict'
                          ? 'text-accent2'
                          : 'text-muted-foreground'
                  }
                >
                  {t(`shotgrid.level.${log.level}` as never)}
                </span>
                <span className="flex-1">
                  {t(log.messageKey as never, log.vars as never)}
                  {log.sgType && (
                    <span className="ml-1 text-muted-foreground">
                      ({log.sgType} #{log.sgId})
                    </span>
                  )}
                </span>
              </li>
            ))}
            {(data?.items ?? []).length === 0 && (
              <li className="px-3 py-3 text-center text-muted-foreground">{t('shotgrid.sync.noLog')}</li>
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
