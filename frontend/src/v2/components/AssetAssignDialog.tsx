import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { api } from '../../lib/apiClient';

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
    next.has(id) ? next.delete(id) : next.add(id);
    setter(next);
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/api/assets/${assetId}`, { shotIds: [...shotIds], sequenceIds: [...sequenceIds] });
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-lg border border-border bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h3 className="text-sm font-semibold">Assigner « {assetName} »</h3>
          <button onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-secondary"><X size={16} /></button>
        </div>
        {error && <p className="px-4 pt-3 text-xs text-destructive">{error}</p>}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <p className="text-sm text-muted-foreground">Chargement…</p>
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
          <button onClick={onClose} className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-secondary/60">Annuler</button>
          <button onClick={save} disabled={busy || loading} className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50">
            {busy ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </div>
    </div>
  );
}
