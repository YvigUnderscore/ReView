// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RotateCcw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { SkeletonRows } from '../../components/ui/skeleton';
import { Panel } from './AdminPrimitives';

interface JobRow {
  id: string | null;
  name: string;
  data: Record<string, unknown>;
  failedReason: string | null;
  attemptsMade: number;
  createdAt: string | null;
}

interface QueueView {
  key: string;
  counts: Record<string, number>;
  failed: JobRow[];
  active: JobRow[];
  waiting: JobRow[];
}

const QUEUE_LABELS: Record<string, string> = {
  media: 'Traitement médias (FFmpeg)',
  'storage-cleanup': 'Nettoyage storage',
  webhooks: 'Webhooks sortants',
};

/** Dashboard BullMQ (37.C) : état des files, jobs échoués (retry), purge. */
export default function JobsTab() {
  const qc = useQueryClient();
  const jobsQ = useQuery({
    queryKey: qk.admin('jobs'),
    queryFn: () => api.get<{ queues: QueueView[] }>('/api/admin/jobs').then((d) => d.queues),
    refetchInterval: 5000,
  });
  if (!jobsQ.data) return <SkeletonRows count={5} />;

  const invalidate = () => qc.invalidateQueries({ queryKey: qk.admin('jobs') });

  const retry = async (queue: string, id: string) => {
    try {
      await api.post(`/api/admin/jobs/${queue}/${id}/retry`);
      toast.success('Job relancé');
      invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erreur');
    }
  };
  const clean = async (queue: string) => {
    try {
      const { removed } = await api.post<{ removed: number }>(`/api/admin/jobs/${queue}/clean-failed`);
      toast.success(`${removed} job(s) échoué(s) purgé(s)`);
      invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erreur');
    }
  };

  return (
    <div className="max-w-3xl space-y-4">
      {jobsQ.data.map((q) => (
        <Panel key={q.key} title={QUEUE_LABELS[q.key] ?? q.key}>
          <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
            <Badge variant="info">{q.counts.active ?? 0} actif(s)</Badge>
            <Badge variant="secondary">{(q.counts.waiting ?? 0) + (q.counts.delayed ?? 0)} en attente</Badge>
            <Badge variant={q.counts.failed ? 'destructive' : 'muted'}>
              {q.counts.failed ?? 0} échoué(s)
            </Badge>
            <Badge variant="muted">{q.counts.completed ?? 0} terminés</Badge>
            {(q.counts.failed ?? 0) > 0 && (
              <Button variant="ghost" size="sm" onClick={() => clean(q.key)} title="Purger les échoués">
                <Trash2 size={13} className="mr-1 text-destructive" /> Purger
              </Button>
            )}
          </div>
          {q.active.length + q.waiting.length > 0 && (
            <p className="mb-1 text-xs text-muted-foreground">
              En cours : {[...q.active, ...q.waiting].map((j) => jobLabel(j)).join(' · ')}
            </p>
          )}
          <div className="space-y-1">
            {q.failed.map((j) => (
              <div
                key={j.id ?? Math.random()}
                className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-1.5 text-xs"
              >
                <div className="min-w-0 flex-1">
                  <span className="font-medium">{jobLabel(j)}</span>
                  <span className="text-muted-foreground"> · {j.attemptsMade} tentative(s)</span>
                  {j.failedReason && (
                    <p className="truncate text-muted-foreground" title={j.failedReason}>
                      {j.failedReason}
                    </p>
                  )}
                </div>
                {j.id && (
                  <Button variant="ghost" size="sm" onClick={() => retry(q.key, j.id!)} title="Relancer">
                    <RotateCcw size={13} />
                  </Button>
                )}
              </div>
            ))}
            {q.failed.length === 0 && <p className="text-xs text-muted-foreground">Aucun échec.</p>}
          </div>
        </Panel>
      ))}
      <DerivedPurgePanel />
    </div>
  );
}

function jobLabel(j: JobRow): string {
  const media = j.data.mediaObjectId ? ` #${j.data.mediaObjectId}` : '';
  const hook = j.data.webhookId ? ` → webhook ${j.data.webhookId}` : '';
  return `${j.name}${media}${hook}`;
}

interface PurgeConfig {
  enabled: boolean;
  keepVersions: number;
}

/** Purge des dérivés obsolètes (37.H) : config + exécution manuelle. */
function DerivedPurgePanel() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: qk.admin('derived-purge'),
    queryFn: () => api.get<{ config: PurgeConfig }>('/api/admin/derived-purge').then((d) => d.config),
  });
  const [draft, setDraft] = useState<PurgeConfig | null>(null);
  const [busy, setBusy] = useState(false);
  if (data && !draft) setDraft(data);
  if (!draft) return null;

  const save = async (next: PurgeConfig) => {
    setDraft(next);
    try {
      await api.put('/api/admin/derived-purge', next);
      qc.invalidateQueries({ queryKey: qk.admin('derived-purge') });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erreur');
    }
  };
  const run = async () => {
    setBusy(true);
    try {
      const { purged } = await api.post<{ purged: number }>('/api/admin/derived-purge/run');
      toast.success(purged > 0 ? `${purged} média(s) allégé(s) (HLS + sprite retirés)` : 'Rien à purger');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="Purge des dérivés obsolètes">
      <p className="mb-2 text-xs text-muted-foreground">
        Les versions au-delà des N dernières de chaque tâche/asset perdent leurs renditions HLS et leur sprite
        (le proxy et la miniature restent : lecture toujours possible). Passage quotidien automatique quand
        activée.
      </p>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            className="accent-primary"
            checked={draft.enabled}
            onChange={(e) => void save({ ...draft, enabled: e.target.checked })}
          />
          Activée
        </label>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Conserver les
          <input
            type="number"
            min={1}
            max={100}
            value={draft.keepVersions}
            onChange={(e) => void save({ ...draft, keepVersions: Math.max(1, Number(e.target.value) || 1) })}
            className="w-16 rounded border border-input bg-background px-2 py-1 text-sm"
          />
          dernières versions
        </label>
        <Button size="sm" variant="outline" onClick={run} disabled={busy || !draft.enabled}>
          Purger maintenant
        </Button>
      </div>
    </Panel>
  );
}
