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

/**
 * Une réponse 4xx est DÉFINITIVE : ce run n'existe pas, ou plus — purgé de l'historique,
 * ou commandé avant qu'on ne retire l'agent. Tout le reste — coupure réseau, 502 du frontal
 * qui reste debout, 503 — est la bascule en cours.
 *
 * Confondre les deux, c'était afficher « l'instance redémarre » pour toujours devant un run
 * qui n'existait plus, sans aucun moyen d'en sortir : le panneau ne proposait « écarter »
 * qu'une fois l'opération TERMINÉE, et elle ne le serait jamais.
 */
const isGone = (error: unknown): boolean =>
  error instanceof ApiError && error.status >= 400 && error.status < 500;

/**
 * Une opération, du dépôt de l'ordre au verdict.
 *
 * ## Pourquoi un sondage HTTP, et pas un socket
 *
 * Parce que l'opération la plus intéressante détruit le processus qui aurait tenu le
 * socket. Pendant une bascule, l'API disparaît une à trois minutes : un socket meurt avec
 * elle, et l'écran ne saurait plus rien de ce qu'il a lui-même déclenché. Le sondage, lui,
 * échoue puis reprend — et le backend qui répond ensuite, celui de la version NOUVELLE,
 * relit le même fichier d'état, écrit par un run lancé par la version précédente.
 *
 * ## La coupure n'est pas une panne
 *
 * Tant que l'opération n'est pas terminée, un échec de requête est le comportement ATTENDU :
 * ni toast, ni panneau d'erreur. On affiche « l'instance redémarre », on continue de
 * sonder, et on reprend le journal au curseur d'octets où on l'avait laissé — ce qui n'est
 * possible que parce que le fichier est écrit en ajout seul.
 */
export default function OpsRunPanel({
  runId,
  onGone,
  onDismiss,
}: {
  runId: string;
  /** Le run n'existe plus : à oublier tout de suite, pour qu'un rechargement reparte propre. */
  onGone: () => void;
  onDismiss: () => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  // Curseur d'octets et journal accumulé. Dans une réf, pas dans un état : la requête doit
  // lire la valeur du moment, et chaque tranche reçue n'a pas à provoquer deux rendus.
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
      // Sonder un run qui n'existe plus n'apprendra jamais rien : on arrête.
      if (isGone(query.state.error)) return false;
      return query.state.data && isTerminalState(query.state.data.run.state) ? false : 2000;
    },
    // Aucune tentative de reprise automatique : c'est le sondage qui fait ce travail, et
    // une pile de reprises pendant une coupure de trois minutes n'apporterait rien.
    retry: false,
    gcTime: 0,
  });

  const run = q.data?.run ?? null;
  const finished = run !== null && isTerminalState(run.state);

  // Le journal défile tout seul tant qu'on regarde une opération en cours.
  useEffect(() => {
    if (!finished && logBox.current) logBox.current.scrollTop = logBox.current.scrollHeight;
  }, [q.data?.log.text, finished]);

  // Une opération terminée change la version en service, l'agent et le catalogue des
  // sauvegardes : l'écran qui l'entoure est périmé au même instant.
  useEffect(() => {
    if (finished) void qc.invalidateQueries({ queryKey: qk.adminOps });
  }, [finished, qc]);

  const cancel = useMutation({
    mutationFn: () => api.post(`/api/admin/ops/runs/${runId}/cancel`),
    onSettled: () => qc.invalidateQueries({ queryKey: qk.adminOpsRun(runId) }),
  });

  const gone = q.isError && isGone(q.error);
  const lost = q.isError && !gone && !finished;

  // Oublié dès qu'on le sait, une seule fois : sans cela, un rechargement ferait revenir le
  // fantôme, et l'écran repartirait pour un tour de « l'instance redémarre » sans fin.
  const forgotten = useRef(false);
  useEffect(() => {
    if (gone && !forgotten.current) {
      forgotten.current = true;
      onGone();
    }
  }, [gone, onGone]);

  // Toujours une sortie. « Écarter » n'apparaissait qu'une fois l'opération terminée : devant
  // un run qui ne se terminerait jamais, l'écran devenait un cul-de-sac. Écarter ne fait que
  // masquer localement — une opération réellement en cours revient au prochain rafraîchissement
  // de l'écran qui l'entoure, il n'y a donc rien à protéger ici.
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
        {/* Chaque texte dans son propre élément : l'espacement d'une boîte flex ne sépare
            que des ENFANTS, et deux nœuds de texte frères se rendaient collés l'un à l'autre. */}
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
          {/* Sortie machine : hors i18n par construction, et c'est ce que dit le `<pre>`. */}
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
              // L'application servie au navigateur date de la version précédente : recharger
              // n'est pas un confort, c'est ce qui met l'écran d'accord avec le serveur.
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

/** Ce qu'il faut retenir d'une opération jouée — et, quand il y a lieu, ce qu'il reste à faire. */
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
        {/* Le code est revenu ; la base, elle, a pu être migrée. On donne la commande, on ne
            la lance pas : une restauration perd tout ce qui a été écrit depuis. */}
        <p className="text-xs text-muted-foreground">{t('ops.result.rolledBackHint')}</p>
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
        {(run.phase === 'backup' || run.phase === 'precheck') && (
          <p className="text-xs text-muted-foreground">{t('ops.result.intact')}</p>
        )}
      </div>
    );
  }
  return null;
}

/** Date lisible dans la langue du lecteur. */
function moment(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(intlLocale(), { dateStyle: 'short', timeStyle: 'short' });
}
