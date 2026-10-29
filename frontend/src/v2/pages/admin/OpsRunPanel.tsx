// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, RotateCw, XCircle } from 'lucide-react';
import { ApiError, api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { useT, intlLocale } from '../../i18n';
import { Panel } from './AdminPrimitives';
import CommandBlock from './CommandBlock';
import {
  isTerminalState,
  runKindLabel,
  runPhaseLabel,
  runStateLabel,
  runStateVariant,
  type RunDetail,
} from './ops';
import { Hint } from '../../components/ui/hint';

/**
 * A 4xx response is FINAL: this run no longer exists, either purged from the history,
 * or ordered before the agent was removed. Everything else (network cut, 502 from the front
 * proxy that stays up, 503) means the switchover is in progress.
 *
 * Confusing the two meant showing "the instance is restarting" forever in front of a run
 * that no longer existed, with no way out: the panel offered "dismiss" only once the
 * operation was FINISHED, and it never would be.
 */
const isGone = (error: unknown): boolean =>
  error instanceof ApiError && error.status >= 400 && error.status < 500;

/**
 * One operation, from submitting the order to the verdict.
 *
 * ## Why HTTP polling, and not a socket
 *
 * Because the most interesting operation destroys the process that would have held the
 * socket. During a switchover the API disappears for one to three minutes: a socket dies with
 * it, and the screen would no longer know anything about what it triggered itself. Polling, on
 * the other hand, fails and then resumes, and the backend that answers afterwards, the one of the
 * NEW version, rereads the same state file, written by a run started by the previous version.
 *
 * ## The cut is not a failure
 *
 * As long as the operation is not finished, a request failure is the EXPECTED behaviour:
 * neither toast nor error panel. We show "the instance is restarting", keep
 * polling, and resume the log at the byte cursor where we left it, which is
 * only possible because the file is written append-only.
 */
export default function OpsRunPanel({
  runId,
  onGone,
  onDismiss,
}: {
  runId: string;
  /** The run no longer exists: forget it right away, so that a reload starts clean. */
  onGone: () => void;
  onDismiss: () => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  // Byte cursor and accumulated log. In a ref, not state: the request must read the current
  // value, and each received chunk must not cause two renders.
  const stream = useRef({ cursor: 0, text: '' });
  const logBox = useRef<HTMLPreElement>(null);

  const q = useQuery({
    queryKey: qk.adminOpsRun(runId),
    queryFn: async () => {
      const detail = await api.get<RunDetail>(`/api/admin/ops/runs/${runId}?from=${stream.current.cursor}`);
      stream.current = { cursor: detail.log.next, text: stream.current.text + detail.log.text };
      return { ...detail, log: { ...detail.log, text: stream.current.text } };
    },
    refetchInterval: (query) => {
      // Polling a run that no longer exists will never learn anything: stop.
      if (isGone(query.state.error)) return false;
      return query.state.data && isTerminalState(query.state.data.run.state) ? false : 2000;
    },
    // No automatic retry: polling does this work, and
    // a stack of retries during a three-minute cut would bring nothing.
    retry: false,
    gcTime: 0,
  });

  const run = q.data?.run ?? null;
  const finished = run !== null && isTerminalState(run.state);

  // The log scrolls on its own while we watch an operation in progress.
  useEffect(() => {
    if (!finished && logBox.current) logBox.current.scrollTop = logBox.current.scrollHeight;
  }, [q.data?.log.text, finished]);

  // A finished operation changes the version in service, the agent and the backup
  // catalogue: the screen around it is stale at the same moment.
  useEffect(() => {
    if (finished) void qc.invalidateQueries({ queryKey: qk.adminOps });
  }, [finished, qc]);

  const cancel = useMutation({
    mutationFn: () => api.post(`/api/admin/ops/runs/${runId}/cancel`),
    onSettled: () => qc.invalidateQueries({ queryKey: qk.adminOpsRun(runId) }),
  });

  const gone = q.isError && isGone(q.error);
  const lost = q.isError && !gone && !finished;

  // Forgotten as soon as we know it, once: otherwise a reload would bring back the
  // ghost, and the screen would restart for another round of "the instance is restarting", endlessly.
  const forgotten = useRef(false);
  useEffect(() => {
    if (gone && !forgotten.current) {
      forgotten.current = true;
      onGone();
    }
  }, [gone, onGone]);

  // Always an exit. "Dismiss" only appeared once the operation was finished: in front of
  // a run that would never finish, the screen became a dead end. Dismiss only hides
  // locally: an operation really in progress comes back at the next refresh of
  // the surrounding screen, so there is nothing to protect here.
  const canDismiss = finished || gone || (lost && run === null);

  return (
    <Panel title={t('ops.run.title')}>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        {run ? (
          <>
            <Badge variant={runStateVariant(run.state)}>{runStateLabel(t, run.state)}</Badge>
            <span>{runKindLabel(t, run.kind)}</span>
            {run.target && <code className="font-mono text-xs">{run.target}</code>}
            {!finished && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Loader2 size={12} className="animate-spin" /> {runPhaseLabel(t, run.phase)}
              </span>
            )}
          </>
        ) : (
          !gone && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Loader2 size={12} className="animate-spin" /> {t('ops.run.phase.queued')}
            </span>
          )
        )}
        {/* Each text in its own element: the spacing of a flex box only separates
            CHILDREN, and two sibling text nodes rendered stuck together. */}
        <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          {run?.startedAt && <span>{t('ops.run.startedAt', { date: moment(run.startedAt) })}</span>}
          {run?.requestedBy && <span>{t('ops.run.requestedBy', { name: run.requestedBy.displayName })}</span>}
        </span>
      </div>

      {lost && <p className="mb-3 text-sm text-muted-foreground">{t('ops.run.reconnecting')}</p>}

      {gone && <p className="mb-3 text-sm text-muted-foreground">{t('ops.run.gone')}</p>}

      {run && finished && <Verdict run={run} />}

      {q.data && q.data.log.text.length > 0 && (
        <div className="mt-3">
          <p className="mb-1 text-xs font-semibold section-label text-muted-foreground">
            {t('ops.run.output')}
          </p>
          {/* Machine output: non-i18n by construction, and that is what the `<pre>` says. */}
          <pre
            ref={logBox}
            className="max-h-64 overflow-auto rounded-md bg-secondary p-2 font-mono text-2xs leading-relaxed"
          >
            {q.data.log.text}
          </pre>
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {run?.cancellable && (
          <Button variant="outline" size="sm" disabled={cancel.isPending} onClick={() => cancel.mutate()}>
            <XCircle size={13} /> {t('common.cancel')}
          </Button>
        )}
        {canDismiss && (
          <>
            <Button variant="ghost" size="sm" onClick={onDismiss}>
              {t('ops.run.dismiss')}
            </Button>
            {run?.kind === 'update' && run.state === 'succeeded' && (
              // The application served to the browser dates from the previous version: reloading
              // is not a convenience, it is what brings the screen back in line with the server.
              <Button size="sm" onClick={() => window.location.reload()}>
                <RotateCw size={13} /> {t('ops.result.reload')}
              </Button>
            )}
          </>
        )}
      </div>
    </Panel>
  );
}

/** What to keep from a played operation, and, where relevant, what remains to be done. */
function Verdict({ run }: { run: NonNullable<RunDetail['run']> }) {
  const t = useT();

  if (run.state === 'succeeded' && run.kind === 'update' && run.target) {
    return <p className="text-sm text-success">{t('ops.result.succeeded', { tag: run.target })}</p>;
  }
  if (run.state === 'succeeded' && run.kind === 'backup') {
    return (
      <p className="text-sm text-success">{t('ops.result.backupDone', { id: run.backupId ?? run.id })}</p>
    );
  }
  if (run.state === 'succeeded') {
    return <p className="text-sm text-success">{t('ops.result.verifyDone', { id: run.target ?? run.id })}</p>;
  }
  if (run.state === 'rolled-back') {
    return (
      <div className="space-y-2 rounded-md border border-warning/30 bg-warning/5 p-3">
        <p className="text-sm">{t('ops.result.rolledBack')}</p>
        {/* The code is back; the database, however, may have been migrated. We give the command, we do not
            run it: a restore loses everything written since. */}
        <Hint>{t('ops.result.rolledBackHint')}</Hint>
        {run.restoreCommand && <CommandBlock command={run.restoreCommand} />}
      </div>
    );
  }
  if (run.state === 'unknown') {
    return (
      <div className="space-y-2 rounded-md border border-warning/30 bg-warning/5 p-3">
        <p className="text-sm">{t('ops.result.unknownHint')}</p>
        <CommandBlock command="docker compose -p review-ops logs --tail=100 ops" />
      </div>
    );
  }
  if (run.state === 'failed') {
    return (
      <div className="space-y-1 rounded-md border border-destructive/30 bg-destructive/5 p-3">
        <p className="text-sm">{t('ops.result.failed')}</p>
        {(run.phase === 'backup' || run.phase === 'precheck') && <Hint>{t('ops.result.intact')}</Hint>}
      </div>
    );
  }
  return null;
}

/** Readable date in the reader's language. */
function moment(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(intlLocale(), { dateStyle: 'short', timeStyle: 'short' });
}
