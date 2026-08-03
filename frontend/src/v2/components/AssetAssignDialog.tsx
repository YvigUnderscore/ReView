// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../../lib/apiClient';
import { qk } from '../lib/query';
import { useSequencesQuery, useShotsQuery } from '../lib/queries';
import { Dialog, DialogContent, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { SkeletonRows } from './ui/skeleton';
import type { ShotSummary } from '../types/api';
import { useT } from '../i18n';

/**
 * Dialog d'assignation d'un asset à des shots et/ou séquences (N-N).
 * Piloté côté asset : PATCH /api/assets/:id { shotIds, sequenceIds }.
 *
 * Les shots sont regroupés par séquence pour distinguer deux shots de même code
 * provenant de séquences différentes : l'affichage est « code séquence · code shot »
 * (le code prime ; le nom n'est qu'un repère secondaire).
 */
export default function AssetAssignDialog({
  assetId,
  projectId,
  assetName,
  onClose,
  onSaved,
}: {
  assetId: number;
  projectId: number;
  assetName: string;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const shotsQ = useShotsQuery(projectId);
  const seqsQ = useSequencesQuery(projectId);
  const assetQ = useQuery({
    queryKey: qk.asset(assetId),
    queryFn: () =>
      api.get<{ asset: { shots: { id: number }[]; sequences: { id: number }[] } }>(`/api/assets/${assetId}`),
  });
  const shots = useMemo(() => shotsQ.data ?? [], [shotsQ.data]);
  const sequences = useMemo(() => seqsQ.data?.sequences ?? [], [seqsQ.data]);
  const loading = shotsQ.isPending || seqsQ.isPending || assetQ.isPending;
  const loadError = shotsQ.error ?? seqsQ.error ?? assetQ.error;

  // Sélection : dérivée des assignations actuelles de l'asset tant que
  // l'utilisateur n'a pas touché aux cases (pas d'effet d'initialisation).
  const [edits, setEdits] = useState<{ shotIds: Set<number>; sequenceIds: Set<number> } | null>(null);
  const shotIds = edits?.shotIds ?? new Set(assetQ.data?.asset.shots.map((s) => s.id) ?? []);
  const sequenceIds = edits?.sequenceIds ?? new Set(assetQ.data?.asset.sequences.map((s) => s.id) ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (kind: 'shotIds' | 'sequenceIds', id: number) => {
    const next = { shotIds: new Set(shotIds), sequenceIds: new Set(sequenceIds) };
    if (next[kind].has(id)) next[kind].delete(id);
    else next[kind].add(id);
    setEdits(next);
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/api/assets/${assetId}`, { shotIds: [...shotIds], sequenceIds: [...sequenceIds] });
      toast.success(t('assets.assignSaved'));
      qc.invalidateQueries({ queryKey: qk.asset(assetId) });
      qc.invalidateQueries({ queryKey: ['shot'] });
      onSaved?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error.generic'));
    } finally {
      setBusy(false);
    }
  };

  // Regroupe les shots par séquence (codes triés numériquement), « Sans séquence » en dernier.
  const groups = useMemo(() => {
    const sortedSeq = [...sequences].sort((a, b) =>
      a.code.localeCompare(b.code, undefined, { numeric: true }),
    );
    const byCode = (a: ShotSummary, b: ShotSummary) =>
      a.code.localeCompare(b.code, undefined, { numeric: true });
    const list: { seq: { id: number; code: string; name: string }; shots: ShotSummary[] }[] = sortedSeq.map(
      (seq) => ({
        seq,
        shots: shots.filter((s) => s.sequenceId === seq.id).sort(byCode),
      }),
    );
    const orphans = shots.filter((s) => s.sequenceId === null).sort(byCode);
    if (orphans.length) list.push({ seq: { id: -1, code: t('shots.noSequence'), name: '' }, shots: orphans });
    return list.filter((g) => g.shots.length > 0);
  }, [shots, sequences, t]);

  const seqById = useMemo(() => new Map(sequences.map((s) => [s.id, s])), [sequences]);

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="flex max-h-[80vh] max-w-lg flex-col p-0">
        <div className="border-b border-border px-4 py-3">
          <DialogTitle className="text-sm">{t('asset.assignTitle', { name: assetName })}</DialogTitle>
        </div>
        {(error ?? loadError?.message) && (
          <p className="px-4 pt-3 text-xs text-destructive">{error ?? loadError?.message}</p>
        )}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <SkeletonRows count={4} />
          ) : (
            <div className="space-y-5">
              {/* Séquences entières */}
              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t('batch.wholeSequences')}
                </div>
                <div className="grid grid-cols-2 gap-1">
                  {sequences.length === 0 && (
                    <p className="text-xs text-muted-foreground">{t('tree.noSequence')}</p>
                  )}
                  {sequences.map((s) => (
                    <label
                      key={s.id}
                      className="flex items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-secondary/50"
                    >
                      <input
                        type="checkbox"
                        checked={sequenceIds.has(s.id)}
                        onChange={() => toggle('sequenceIds', s.id)}
                      />
                      <span className="font-medium">{s.code}</span>
                      {s.name && <span className="truncate text-muted-foreground">· {s.name}</span>}
                    </label>
                  ))}
                </div>
              </div>

              {/* Shots regroupés par séquence */}
              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t('shots.title')}
                </div>
                {groups.length === 0 && (
                  <p className="text-xs text-muted-foreground">{t('sequences.noShot')}</p>
                )}
                <div className="space-y-3">
                  {groups.map((g) => (
                    <div key={g.seq.id}>
                      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-primary/80">
                        {g.seq.code}
                      </div>
                      <div className="grid grid-cols-2 gap-1">
                        {g.shots.map((sh) => {
                          const seqCode = sh.sequenceId != null ? seqById.get(sh.sequenceId)?.code : null;
                          return (
                            <label
                              key={sh.id}
                              className="flex items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-secondary/50"
                            >
                              <input
                                type="checkbox"
                                checked={shotIds.has(sh.id)}
                                onChange={() => toggle('shotIds', sh.id)}
                              />
                              <span className="font-medium">
                                {seqCode ? `${seqCode} · ${sh.code}` : sh.code}
                              </span>
                              {sh.name && sh.name !== sh.code && (
                                <span className="truncate text-muted-foreground">· {sh.name}</span>
                              )}
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <Button variant="outline" size="sm" onClick={onClose}>
            {t('common.undo')}
          </Button>
          <Button size="sm" onClick={save} disabled={busy || loading}>
            {busy ? 'Enregistrement…' : t('common.save')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
