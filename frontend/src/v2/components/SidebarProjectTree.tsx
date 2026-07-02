import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronRight, KanbanSquare, PenTool, Layers, Film, Box } from 'lucide-react';
import { api } from '../../lib/apiClient';
import { Skeleton } from './ui/skeleton';

/**
 * Arbre de navigation du projet courant dans la sidebar (10.A4) :
 * Kanban/Board + Séquences → Shots (lazy-load) + Assets (lazy-load).
 * État déplié/replié persisté par projet (localStorage). Monter avec
 * `key={projectId}` pour réinitialiser l'état au changement de projet.
 */

interface SeqNode { id: number; code: string; name: string; _count: { shots: number } }
interface ShotNode { id: number; code: string; name: string }
interface AssetNode { id: number; name: string; type: string }

// Id virtuel de l'entrée « Hors séquence » dans la liste des séquences dépliées.
const NO_SEQ = 0;

interface TreeOpenState { sequences: boolean; assets: boolean; seqs: number[] }

const stateKey = (projectId: number) => `review:tree:${projectId}`;

function readOpenState(projectId: number): TreeOpenState {
  try {
    const raw = localStorage.getItem(stateKey(projectId));
    if (raw) return JSON.parse(raw) as TreeOpenState;
  } catch { /* état par défaut ci-dessous */ }
  return { sequences: true, assets: false, seqs: [] };
}

const rowClass = 'flex w-full items-center gap-2 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground';

export default function SidebarProjectTree({ projectId }: { projectId: number }) {
  const [open, setOpen] = useState(() => readOpenState(projectId));
  const [sequences, setSequences] = useState<SeqNode[] | null>(null);
  const [unsequenced, setUnsequenced] = useState(0);
  const [assets, setAssets] = useState<AssetNode[] | null>(null);
  const [shotsBySeq, setShotsBySeq] = useState<Record<number, ShotNode[]>>({});

  // Persistance de l'état déplié/replié par projet.
  useEffect(() => {
    localStorage.setItem(stateKey(projectId), JSON.stringify(open));
  }, [open, projectId]);

  useEffect(() => {
    if (!open.sequences || sequences !== null) return;
    api.get<{ sequences: SeqNode[]; unsequencedShots: number }>(`/api/sequences?projectId=${projectId}`)
      .then((d) => { setSequences(d.sequences); setUnsequenced(d.unsequencedShots); })
      .catch(() => setSequences([]));
  }, [open.sequences, sequences, projectId]);

  useEffect(() => {
    if (!open.assets || assets !== null) return;
    api.get<{ assets: AssetNode[] }>(`/api/assets?projectId=${projectId}`)
      .then((d) => setAssets(d.assets))
      .catch(() => setAssets([]));
  }, [open.assets, assets, projectId]);

  // Charge les shots des séquences dépliées manquants — couvre le clic ET
  // l'état restauré du localStorage au montage.
  const pendingSeqs = useRef(new Set<number>());
  useEffect(() => {
    if (!open.sequences) return;
    for (const seqId of open.seqs) {
      if (seqId in shotsBySeq || pendingSeqs.current.has(seqId)) continue;
      pendingSeqs.current.add(seqId);
      api.get<{ shots: ShotNode[] }>(`/api/shots?projectId=${projectId}&sequenceId=${seqId === NO_SEQ ? 'none' : seqId}`)
        .then((d) => setShotsBySeq((m) => ({ ...m, [seqId]: d.shots })))
        .catch(() => setShotsBySeq((m) => ({ ...m, [seqId]: [] })))
        .finally(() => pendingSeqs.current.delete(seqId));
    }
  }, [open.sequences, open.seqs, shotsBySeq, projectId]);

  const toggleSeq = (seqId: number) => {
    setOpen((o) => ({ ...o, seqs: o.seqs.includes(seqId) ? o.seqs.filter((s) => s !== seqId) : [...o.seqs, seqId] }));
  };

  const renderShots = (seqId: number) => {
    const shots = shotsBySeq[seqId];
    if (!shots) return <Skeleton className="ml-6 my-1 h-4 w-28" />;
    if (shots.length === 0) return <p className="ml-6 px-2 py-0.5 text-[11px] text-muted-foreground/70">Aucun shot.</p>;
    return shots.map((s) => (
      <Link
        key={s.id}
        to={`/projects/${projectId}?tab=shots&shot=${s.id}`}
        title={`${s.code} — ${s.name}`}
        className={`${rowClass} ml-6`}
      >
        <Film size={12} className="shrink-0" />
        <span className="truncate">{s.code}</span>
      </Link>
    ));
  };

  return (
    <div className="ml-6 space-y-0.5 border-l border-border pl-2">
      <Link to={`/projects/${projectId}/kanban`} className={rowClass}>
        <KanbanSquare size={13} /> Kanban
      </Link>
      <Link to={`/projects/${projectId}/board`} className={rowClass}>
        <PenTool size={13} /> Board
      </Link>

      {/* Section Séquences → Shots */}
      <button onClick={() => setOpen((o) => ({ ...o, sequences: !o.sequences }))} className={rowClass}>
        {open.sequences ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <Layers size={13} /> Séquences
      </button>
      {open.sequences && (
        sequences === null ? (
          <div className="ml-6 space-y-1 py-1"><Skeleton className="h-4 w-32" /><Skeleton className="h-4 w-24" /></div>
        ) : (
          <div className="space-y-0.5">
            {sequences.length === 0 && unsequenced === 0 && (
              <p className="ml-6 px-2 py-0.5 text-[11px] text-muted-foreground/70">Aucune séquence.</p>
            )}
            {sequences.map((sq) => (
              <div key={sq.id}>
                <button onClick={() => toggleSeq(sq.id)} title={`${sq.code} — ${sq.name}`} className={`${rowClass} ml-3`}>
                  {open.seqs.includes(sq.id) ? <ChevronDown size={12} className="shrink-0" /> : <ChevronRight size={12} className="shrink-0" />}
                  <span className="truncate">{sq.code}</span>
                  <span className="ml-auto shrink-0 text-[10px] text-muted-foreground/70">{sq._count.shots}</span>
                </button>
                {open.seqs.includes(sq.id) && renderShots(sq.id)}
              </div>
            ))}
            {unsequenced > 0 && (
              <div>
                <button onClick={() => toggleSeq(NO_SEQ)} className={`${rowClass} ml-3`}>
                  {open.seqs.includes(NO_SEQ) ? <ChevronDown size={12} className="shrink-0" /> : <ChevronRight size={12} className="shrink-0" />}
                  <span className="truncate italic">Hors séquence</span>
                  <span className="ml-auto shrink-0 text-[10px] text-muted-foreground/70">{unsequenced}</span>
                </button>
                {open.seqs.includes(NO_SEQ) && renderShots(NO_SEQ)}
              </div>
            )}
          </div>
        )
      )}

      {/* Section Assets */}
      <button onClick={() => setOpen((o) => ({ ...o, assets: !o.assets }))} className={rowClass}>
        {open.assets ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <Box size={13} /> Assets
      </button>
      {open.assets && (
        assets === null ? (
          <div className="ml-6 space-y-1 py-1"><Skeleton className="h-4 w-32" /><Skeleton className="h-4 w-24" /></div>
        ) : assets.length === 0 ? (
          <p className="ml-6 px-2 py-0.5 text-[11px] text-muted-foreground/70">Aucun asset.</p>
        ) : (
          assets.map((a) => (
            <Link key={a.id} to={`/assets/${a.id}`} title={a.name} className={`${rowClass} ml-3`}>
              <Box size={12} className="shrink-0" />
              <span className="truncate">{a.name}</span>
            </Link>
          ))
        )
      )}
    </div>
  );
}
