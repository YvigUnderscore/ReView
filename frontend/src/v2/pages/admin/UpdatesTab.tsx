// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DownloadCloud } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Checkbox } from '../../components/ui/checkbox';
import { QueryState } from '../../components/ui/query-state';
import { SkeletonRows } from '../../components/ui/skeleton';
import { useT } from '../../i18n';
import { Panel } from './AdminPrimitives';
import BackupsPanel from './BackupsPanel';
import CommandBlock from './CommandBlock';
import OpsConfirmDialog from './OpsConfirmDialog';
import OpsRunPanel from './OpsRunPanel';
import ReleasePanel from './ReleasePanel';
import {
  canBackupFromHere,
  canUpdateFromHere,
  mechanismNotice,
  runKindLabel,
  runStateLabel,
  runStateVariant,
  type OpsKind,
  type OpsOverview,
  type RunSummary,
} from './ops';

/**
 * « Mises à jour & sauvegardes » : ce que fait tourner l'instance, ce qui est paru depuis,
 * et — quand elle en est capable — les deux ou trois gestes qui la font avancer.
 *
 * ## La règle de cet écran : jamais un bouton mort
 *
 * Une instance sans agent d'exploitation, en mode construction, ou dont l'agent est muet,
 * ne peut pas agir sur elle-même. L'écran n'y grise pas ses boutons — un bouton désactivé
 * fait croire à une panne et n'apprend rien — il ne les rend pas, et affiche à la place la
 * commande exacte, prête à coller dans le terminal de la machine qui héberge l'instance.
 * C'est la moitié la plus souvent utile de cette page : elle fonctionne partout.
 */

/** L'opération commandée dure au-delà de la vie de cet onglet : on retient laquelle. */
const RUN_KEY = 'review:ops-run';

const rememberRun = (id: string | null) => {
  try {
    if (id) localStorage.setItem(RUN_KEY, id);
    else localStorage.removeItem(RUN_KEY);
  } catch {
    /* stockage indisponible : on perd le suivi au rechargement, rien de plus. */
  }
};

const rememberedRun = (): string | null => {
  try {
    return localStorage.getItem(RUN_KEY);
  } catch {
    return null;
  }
};

interface Pending {
  kind: OpsKind;
  version?: string;
  backupId?: string;
}

export default function UpdatesTab() {
  const t = useT();
  const qc = useQueryClient();
  const [pending, setPending] = useState<Pending | null>(null);
  const [withBackup, setWithBackup] = useState(true);
  const [dismissed, setDismissed] = useState<string | null>(null);

  const overviewQ = useQuery({
    queryKey: qk.adminOps,
    queryFn: () => api.get<OpsOverview>('/api/admin/ops'),
    // La version en service ne change qu'à une bascule ; le catalogue distant est déjà mis
    // en cache une demi-heure côté serveur. Redemander à chaque montage n'apprend rien.
    staleTime: 5 * 60_000,
  });

  const start = useMutation({
    mutationFn: (body: Pending & { currentPassword: string }) =>
      api.post<{ run: { id: string } }>('/api/admin/ops/runs', {
        kind: body.kind,
        version: body.version,
        backupId: body.backupId,
        skipBackup: body.kind === 'update' ? !withBackup : false,
        currentPassword: body.currentPassword,
      }),
    onSuccess: (res) => {
      rememberRun(res.run.id);
      setDismissed(null);
      setPending(null);
      void qc.invalidateQueries({ queryKey: qk.adminOps });
    },
    // Le message est déjà dans la langue du lecteur : `apiClient` traduit par le code.
    onError: (err: unknown) => toast.error(err instanceof Error ? err.message : t('common.error.generic')),
  });

  if (!overviewQ.data) return <QueryState query={overviewQ} skeleton={<SkeletonRows count={4} />} />;
  const overview = overviewQ.data;

  // Le run à suivre : celui que le serveur dit actif, sinon celui que cet onglet a lancé —
  // c'est ce second cas qui survit à la coupure d'une mise à jour, quand l'API ne répond
  // plus et ne peut donc plus rien dire d'actif.
  const followed = overview.activeRun?.id ?? rememberedRun();
  const runId = followed && followed !== dismissed ? followed : null;

  const notice = mechanismNotice(t, overview.mechanism, overview.commands, (iso) =>
    new Date(iso).toLocaleString(),
  );
  const canUpdate = canUpdateFromHere(overview) && runId === null;

  return (
    <div className="space-y-4">
      {runId && (
        <OpsRunPanel
          key={runId}
          runId={runId}
          onDismiss={() => {
            setDismissed(runId);
            rememberRun(null);
          }}
        />
      )}

      <ReleasePanel overview={overview} />

      {canUpdate && overview.latest && (
        <div className="flex justify-end">
          <Button onClick={() => setPending({ kind: 'update', version: overview.latest?.tag })}>
            <DownloadCloud size={14} /> {t('ops.update.action', { tag: overview.latest.tag })}
          </Button>
        </div>
      )}

      {notice && (
        <Panel title={t('ops.manual.title')}>
          <p className={`text-sm ${notice.tone === 'warning' ? 'text-warning' : 'text-muted-foreground'}`}>
            {notice.text}
          </p>
          <div className="mt-3 space-y-2">
            {overview.mechanism.state === 'absent' && (
              <p className="text-xs text-muted-foreground">{t('ops.manual.body')}</p>
            )}
            {overview.commands.update && overview.mechanism.state === 'absent' && (
              <CommandBlock command={overview.commands.update} />
            )}
            {notice.command && (
              <>
                {overview.mechanism.state === 'absent' && (
                  <p className="text-xs text-muted-foreground">{t('ops.agent.install')}</p>
                )}
                {overview.mechanism.state !== 'absent' && (
                  <p className="text-xs text-muted-foreground">{t('ops.agent.diagnose')}</p>
                )}
                <CommandBlock command={notice.command} />
              </>
            )}
          </div>
        </Panel>
      )}

      {/* Le mode construction n'a pas de bouton, mais il a une commande : sans elle, l'écran
          se contenterait d'annoncer une version disponible sans dire comment y aller. */}
      {overview.mode === 'build' && overview.commands.update && !notice && (
        <Panel title={t('ops.manual.title')}>
          <p className="text-xs text-muted-foreground">{t('ops.manual.body')}</p>
          <div className="mt-2">
            <CommandBlock command={overview.commands.update} />
          </div>
        </Panel>
      )}

      <BackupsPanel
        catalog={overview.backups}
        mechanism={overview.mechanism}
        busy={start.isPending || runId !== null}
        onCreate={() => canBackupFromHere(overview) && setPending({ kind: 'backup' })}
        onCheck={(id) => setPending({ kind: 'verify', backupId: id })}
      />

      <OpsHistory runs={overview.recentRuns.filter((r) => r.id !== runId)} />

      <OpsConfirmDialog
        open={pending !== null}
        title={pending?.kind === 'update' ? t('ops.update.confirmTitle') : t('ops.run.title')}
        body={
          pending?.kind === 'update'
            ? t('ops.update.confirmBody', { tag: pending.version ?? '' })
            : pending?.kind === 'verify'
              ? t('ops.backups.checkHint')
              : t('ops.backups.create')
        }
        confirmLabel={pending?.kind === 'update' ? t('common.confirm') : t('common.confirm')}
        busy={start.isPending}
        extra={
          pending?.kind === 'update' ? (
            <div className="space-y-2 rounded-md border border-warning/30 bg-warning/5 p-3 text-xs">
              <p>{t('ops.update.doNotReload')}</p>
              <label className="flex items-center gap-2">
                <Checkbox checked={withBackup} onCheckedChange={(v) => setWithBackup(v === true)} />
                {t('ops.update.withBackup')}
              </label>
              {!withBackup && <p className="text-warning">{t('ops.update.withoutBackup')}</p>}
            </div>
          ) : null
        }
        onConfirm={(currentPassword) => pending && start.mutate({ ...pending, currentPassword })}
        onClose={() => setPending(null)}
      />
    </div>
  );
}

/**
 * Les dernières opérations, en une ligne chacune.
 *
 * Ce n'est pas un journal d'audit — celui-là vit dans « Activité » — mais la mémoire courte
 * de l'écran : savoir qu'une sauvegarde a eu lieu ce matin, et qu'elle a abouti, évite d'en
 * relancer une avant de basculer.
 */
function OpsHistory({ runs }: { runs: RunSummary[] }) {
  const t = useT();
  if (runs.length === 0) return null;
  return (
    <Panel title={t('ops.history.title')}>
      <ul className="space-y-1 text-sm">
        {runs.map((run) => (
          <li key={run.id} className="flex flex-wrap items-center gap-2">
            <Badge variant={runStateVariant(run.state)}>{runStateLabel(t, run.state)}</Badge>
            <span>{runKindLabel(t, run.kind)}</span>
            {run.target && <code className="font-mono text-xs">{run.target}</code>}
            {run.requestedBy && (
              <span className="text-xs text-muted-foreground">
                {t('ops.run.requestedBy', { name: run.requestedBy.displayName })}
              </span>
            )}
            <span className="ml-auto font-mono text-2xs text-muted-foreground">{run.id}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
