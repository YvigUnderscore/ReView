import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueries } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, KanbanSquare, PenTool, Layers, Film, Box } from 'lucide-react';
import { api } from '../../lib/apiClient';
import { qk } from '../lib/query';
import { useSequencesQuery, useAssetsQuery } from '../lib/queries';
import { Skeleton } from './ui/skeleton';

/**
 * Arbre de navigation du projet courant dans la sidebar (10.A4) :
 * Kanban/Board + Séquences → Shots (lazy-load) + Assets (lazy-load).
 * État déplié/replié persisté par projet (localStorage). Monter avec
 * `key={projectId}` pour réinitialiser l'état au changement de projet.
 */

interface ShotNode { id: number; code: string; name: string }

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

  // Persistance de l'état déplié/replié par projet.
  useEffect(() => {
    localStorage.setItem(stateKey(projectId), JSON.stringify(open));
  }, [open, projectId]);

  const seqQ = useSequencesQuery(projectId, open.sequences);
  const sequences = seqQ.isError ? [] : (seqQ.data?.sequences ?? null);
  const unsequenced = seqQ.data?.unsequencedShots ?? 0;

  const assetsQ = useAssetsQuery(projectId, open.assets);
  const assets = assetsQ.isError ? [] : (assetsQ.data ?? null);

  // Une query par séquence dépliée (lazy-load) — couvre le clic ET l'état
  // restauré du localStorage au montage.
  const shotQueries = useQueries({
    queries: (open.sequences ? open.seqs : []).map((seqId) => ({
      queryKey: qk.shotsOfSequence(projectId, seqId === NO_SEQ ? 'none' : seqId),
      queryFn: () =>
        api.get<{ shots: ShotNode[] }>(`/api/shots?projectId=${projectId}&sequenceId=${seqId === NO_SEQ ? 'none' : seqId}`)
          .then((d) => d.shots),
    })),
  });
  const shotsBySeq: Record<number, ShotNode[] | undefined> = {};
  (open.sequences ? open.seqs : []).forEach((seqId, i) => {
    const q = shotQueries[i];
    shotsBySeq[seqId] = q?.isError ? [] : q?.data;
  });

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
