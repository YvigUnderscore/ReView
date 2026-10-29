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
import { intlLocale, useT, type Tr } from '../../i18n';
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
import { Hint } from '../../components/ui/hint';

/**
 * "Updates & backups": what the instance runs, what has been released since,
 * and — when it is able to — the two or three gestures that move it forward.
 *
 * ## The rule of this screen: never a dead button
 *
 * An instance without an operations agent, in build mode, or whose agent is silent,
 * cannot act on itself. The screen does not grey out its buttons there — a disabled button
 * suggests a fault and teaches nothing — it does not render them, and shows instead the
 * exact command, ready to paste into the terminal of the machine hosting the instance.
 * This is the half of this page most often useful: it works everywhere.
 */

/** The ordered operation lasts beyond this tab's life: we remember which one. */
const RUN_KEY = 'review:ops-run';

const rememberRun = (id: string | null) => {
  try {
    if (id) localStorage.setItem(RUN_KEY, id);
    else localStorage.removeItem(RUN_KEY);
  } catch {
    /* storage unavailable: we only lose tracking on reload, nothing more. */
  }
};

const rememberedRun = (): string | null => {
  try {
    return localStorage.getItem(RUN_KEY);
  } catch {
    return null;
  }
};

/** Title of the confirmation dialog — a gesture is named, not announced as "in progress". */
function confirmTitle(t: Tr, kind: OpsKind | undefined): string {
  if (kind === 'update') return t('ops.update.confirmTitle');
  if (kind === 'verify') return t('ops.backups.check');
  return t('ops.backups.create');
}

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
    // The version in service only changes at a switchover; the remote catalogue is already
    // cached for half an hour on the server side. Re-requesting on each mount teaches nothing.
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
    // The message is already in the reader's language: `apiClient` translates it on the code side.
    onError: (err: unknown) => toast.error(err instanceof Error ? err.message : t('common.error.generic')),
  });

  if (!overviewQ.data) return <QueryState query={overviewQ} skeleton={<SkeletonRows count={4} />} />;
  const overview = overviewQ.data;

  // The run to follow: the one the server says is active, otherwise the one this tab launched —
  // it is this second case that survives an update cut, when the API no longer answers and
  // can therefore no longer say anything is active.
  const followed = overview.activeRun?.id ?? rememberedRun();
  const runId = followed && followed !== dismissed ? followed : null;

  const notice = mechanismNotice(t, overview.mechanism, overview.commands, (iso) =>
    new Date(iso).toLocaleString(intlLocale()),
  );
  const canUpdate = canUpdateFromHere(overview) && runId === null;

  return (
    <div className="space-y-4">
      {runId && (
        <OpsRunPanel
          key={runId}
          runId={runId}
          onGone={() => rememberRun(null)}
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
            {overview.mechanism.state === 'absent' && <Hint>{t('ops.manual.body')}</Hint>}
            {overview.commands.update && overview.mechanism.state === 'absent' && (
              <CommandBlock command={overview.commands.update} />
            )}
            {notice.command && (
              <>
                {overview.mechanism.state === 'absent' && <Hint>{t('ops.agent.install')}</Hint>}
                {overview.mechanism.state !== 'absent' && <Hint>{t('ops.agent.diagnose')}</Hint>}
                <CommandBlock command={notice.command} />
              </>
            )}
          </div>
        </Panel>
      )}

      {/* Build mode has no button, but it has a command: without it, the screen
          would merely announce an available version without saying how to get there. */}
      {overview.mode === 'build' && overview.commands.update && !notice && (
        <Panel title={t('ops.manual.title')}>
          <Hint>{t('ops.manual.body')}</Hint>
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
        title={confirmTitle(t, pending?.kind)}
        body={
          pending?.kind === 'update'
            ? t('ops.update.confirmBody', { tag: pending.version ?? '' })
            : pending?.kind === 'verify'
              ? t('ops.backups.checkHint')
              : t('ops.backups.createHint')
        }
        confirmLabel={t('common.confirm')}
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
 * The latest operations, one line each.
 *
 * This is not an audit log — that one lives in "Activity" — but the short-term memory
 * of the screen: knowing that a backup took place this morning, and that it succeeded, avoids
 * launching another one before switching over.
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
