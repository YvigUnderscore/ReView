import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { api } from '../../lib/apiClient';
import { Dialog, DialogContent, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { SkeletonRows } from './ui/skeleton';

interface Shot { id: number; code: string; name: string; sequenceId: number | null }
interface Sequence { id: number; code: string; name: string }

/**
 * Dialog d'assignation d'un asset à des shots et/ou séquences (N-N).
 * Piloté côté asset : PATCH /api/assets/:id { shotIds, sequenceIds }.
 *
 * Les shots sont regroupés par séquence pour distinguer deux shots de même code
 * provenant de séquences différentes : l'affichage est « code séquence · code shot »
 * (le code prime ; le nom n'est qu'un repère secondaire).
 */
export default function AssetAssignDialog({
  assetId, projectId, assetName, onClose, onSaved,
}: {
  assetId: number; projectId: number; assetName: string; onClose: () => void; onSaved?: () => void;
}) {
  const [shots, setShots] = useState<Shot[]>([]);
  const [sequences, setSequences] = useState<Sequence[]>([]);
  const [shotIds, setShotIds] = useState<Set<number>>(new Set());
  const [sequenceIds, setSequenceIds] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.get<{ shots: Shot[] }>(`/api/shots?projectId=${projectId}`),
      api.get<{ sequences: Sequence[] }>(`/api/sequences?projectId=${projectId}`),
      api.get<{ asset: { shots: { id: number }[]; sequences: { id: number }[] } }>(`/api/assets/${assetId}`),
    ])
      .then(([sh, sq, a]) => {
        setShots(sh.shots);
        setSequences(sq.sequences);
        setShotIds(new Set(a.asset.shots.map((s) => s.id)));
        setSequenceIds(new Set(a.asset.sequences.map((s) => s.id)));
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Erreur'))
      .finally(() => setLoading(false));
  }, [assetId, projectId]);

  const toggle = (set: Set<number>, setter: (s: Set<number>) => void, id: number) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setter(next);
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/api/assets/${assetId}`, { shotIds: [...shotIds], sequenceIds: [...sequenceIds] });
      toast.success('Assignations enregistrées');
      onSaved?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setBusy(false);
    }
  };

  // Regroupe les shots par séquence (codes triés numériquement), « Sans séquence » en dernier.
  const groups = useMemo(() => {
    const sortedSeq = [...sequences].sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
    const byCode = (a: Shot, b: Shot) => a.code.localeCompare(b.code, undefined, { numeric: true });
    const list = sortedSeq.map((seq) => ({
      seq,
      shots: shots.filter((s) => s.sequenceId === seq.id).sort(byCode),
    }));
    const orphans = shots.filter((s) => s.sequenceId === null).sort(byCode);
    if (orphans.length) list.push({ seq: { id: -1, code: 'Sans séquence', name: '' }, shots: orphans });
    return list.filter((g) => g.shots.length > 0);
  }, [shots, sequences]);

  const seqById = useMemo(() => new Map(sequences.map((s) => [s.id, s])), [sequences]);

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="flex max-h-[80vh] max-w-lg flex-col p-0">
        <div className="border-b border-border px-4 py-3">
          <DialogTitle className="text-sm">Assigner « {assetName} »</DialogTitle>
        </div>
        {error && <p className="px-4 pt-3 text-xs text-destructive">{error}</p>}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <SkeletonRows count={4} />
          ) : (
            <div className="space-y-5">
              {/* Séquences entières */}
              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Séquences entières</div>
                <div className="grid grid-cols-2 gap-1">
                  {sequences.length === 0 && <p className="text-xs text-muted-foreground">Aucune séquence.</p>}
                  {sequences.map((s) => (
                    <label key={s.id} className="flex items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-secondary/50">
                      <input type="checkbox" checked={sequenceIds.has(s.id)} onChange={() => toggle(sequenceIds, setSequenceIds, s.id)} />
                      <span className="font-medium">{s.code}</span>
                      {s.name && <span className="truncate text-muted-foreground">· {s.name}</span>}
                    </label>
                  ))}
                </div>
              </div>

              {/* Shots regroupés par séquence */}
              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Shots</div>
                {groups.length === 0 && <p className="text-xs text-muted-foreground">Aucun shot.</p>}
                <div className="space-y-3">
                  {groups.map((g) => (
                    <div key={g.seq.id}>
                      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-primary/80">{g.seq.code}</div>
                      <div className="grid grid-cols-2 gap-1">
                        {g.shots.map((sh) => {
                          const seqCode = sh.sequenceId != null ? seqById.get(sh.sequenceId)?.code : null;
                          return (
                            <label key={sh.id} className="flex items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-secondary/50">
                              <input type="checkbox" checked={shotIds.has(sh.id)} onChange={() => toggle(shotIds, setShotIds, sh.id)} />
                              <span className="font-medium">{seqCode ? `${seqCode} · ${sh.code}` : sh.code}</span>
                              {sh.name && sh.name !== sh.code && <span className="truncate text-muted-foreground">· {sh.name}</span>}
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
          <Button variant="outline" size="sm" onClick={onClose}>Annuler</Button>
          <Button size="sm" onClick={save} disabled={busy || loading}>
            {busy ? 'Enregistrement…' : 'Enregistrer'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
