import { useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '../../components/ui/context-menu';
import type { TimelineMarker } from '../../types/api';
import type { TimelineMarkersApi } from './useTimelineMarkers';

/** Palette proposée pour les marqueurs (34.C) — libre côté API (hex), guidée côté UI. */
const MARKER_COLORS = ['#22d3ee', '#f472b6', '#facc15', '#4ade80', '#f87171', '#a78bfa'];

/**
 * Ticks des marqueurs partagés sur la timeline (34.C) : trait coloré + fanion, tooltip
 * nom/auteur, clic = seek, clic droit = renommer/supprimer (auteur ou superviseur).
 */
export function MarkerTicks({
  api,
  duration,
  fps,
  onSeek,
  onEdit,
}: {
  api: TimelineMarkersApi;
  duration: number;
  fps: number;
  onSeek: (t: number) => void;
  onEdit: (m: TimelineMarker) => void;
}) {
  if (duration <= 0) return null;
  return (
    <>
      {api.markers.map((m) => {
        const t = m.frame / (fps || 24);
        if (t > duration) return null;
        const tick = (
          <button
            className="absolute bottom-0 top-1/2 z-[15] w-1 -translate-x-1/2 rounded-t-sm opacity-90 hover:opacity-100"
            style={{
              left: `calc(${(t / duration) * 100}% * (100% - 8px) / 100% + 4px)`,
              background: m.color,
            }}
            title={`${m.name}${m.authorName ? ` — ${m.authorName}` : ''}`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onSeek(t);
            }}
          />
        );
        if (!api.canManage(m)) return <span key={m.id}>{tick}</span>;
        return (
          <ContextMenu key={m.id}>
            <ContextMenuTrigger asChild>{tick}</ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem onClick={() => onEdit(m)}>
                <Pencil size={14} /> Renommer / recolorer…
              </ContextMenuItem>
              <ContextMenuItem danger onClick={() => void api.remove(m)}>
                <Trash2 size={14} /> Supprimer le marqueur
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        );
      })}
    </>
  );
}

/**
 * Dialog de création/édition d'un marqueur : nom + palette de couleurs. Monté à chaque
 * ouverture (l'appelant le rend conditionnellement) — l'état initial vient des props.
 */
export function MarkerDialog({
  onClose,
  frame,
  startFrame,
  editing,
  api,
}: {
  onClose: () => void;
  /** Frame visée (création) — ignorée en édition. */
  frame: number;
  startFrame: number;
  /** Marqueur en cours d'édition (null = création). */
  editing: TimelineMarker | null;
  api: TimelineMarkersApi;
}) {
  const [name, setName] = useState(editing?.name ?? '');
  const [color, setColor] = useState(editing?.color ?? MARKER_COLORS[0]!);

  const submit = async () => {
    const n = name.trim();
    if (!n) return;
    if (editing) await api.rename(editing, n, color);
    else await api.add(frame, n, color);
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {editing ? 'Modifier le marqueur' : `Marqueur à la frame ${startFrame + (editing ? 0 : frame)}`}
          </DialogTitle>
        </DialogHeader>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void submit()}
          placeholder="Nom du marqueur (ex. Début du plan 2)"
          autoFocus
        />
        <div className="flex items-center gap-2">
          {MARKER_COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              className={`h-6 w-6 rounded-full ring-offset-2 ring-offset-background ${color === c ? 'ring-2 ring-foreground' : ''}`}
              style={{ background: c }}
              title={c}
            />
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Annuler
          </Button>
          <Button onClick={() => void submit()} disabled={!name.trim()}>
            {editing ? 'Modifier' : 'Ajouter'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
