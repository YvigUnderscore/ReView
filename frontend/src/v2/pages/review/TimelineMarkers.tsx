// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

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
import { useT } from '../../i18n';

/** Suggested palette for markers (34.C) — free on the API side (hex), guided on the UI side. */
const MARKER_COLORS = ['#22d3ee', '#f472b6', '#facc15', '#4ade80', '#f87171', '#a78bfa'];

/**
 * Shared marker ticks on the timeline (34.C): colored line + flag, name/author tooltip,
 * click = seek, right-click = rename/delete (author or supervisor).
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
  const tr = useT();
  if (duration <= 0) return null;
  return (
    <>
      {api.markers.map((m) => {
        const t = m.frame / (fps || 24);
        if (t > duration) return null;
        const tick = (
          // Click area widened (10 px) around the 4 px line — comfortable hover and right-click.
          // stopPropagation on contextmenu: without it the bar's menu ("Add a marker here…")
          // also opened and made this one inoperative.
          <button
            className="group absolute bottom-0 top-1/2 z-[15] flex w-2.5 -translate-x-1/2 justify-center"
            style={{ left: `calc(${(t / duration) * 100}% * (100% - 8px) / 100% + 4px)` }}
            onPointerDown={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onSeek(t);
            }}
          >
            <span
              className="h-full w-1 rounded-t-sm opacity-90 group-hover:opacity-100"
              style={{ background: m.color }}
            />
            {/* Custom tooltip: name + author on hover (the native title was too subtle). */}
            <span className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-1.5 hidden -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-card px-2 py-0.5 text-2xs text-foreground shadow-lg group-hover:block">
              {m.name}
              {m.authorName ? <span className="text-muted-foreground"> — {m.authorName}</span> : null}
            </span>
          </button>
        );
        if (!api.canManage(m)) return <span key={m.id}>{tick}</span>;
        return (
          <ContextMenu key={m.id}>
            <ContextMenuTrigger asChild>{tick}</ContextMenuTrigger>
            {/* Portaled into the DOM but a React child of the bar: without stopPropagation the
                pointerdown des items remontent (arbre React) au onPointerDown de la barre,
                qui seek + capture le pointer — et vole le pointerup qui déclenche l'item. */}
            <ContextMenuContent
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <ContextMenuItem onClick={() => onEdit(m)}>
                <Pencil size={14} /> {tr('marker.rename')}
              </ContextMenuItem>
              <ContextMenuItem danger onClick={() => void api.remove(m)}>
                <Trash2 size={14} /> {tr('marker.delete')}
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        );
      })}
    </>
  );
}

/**
 * Dialog to create/edit a marker: name + color palette. Mounted on each opening (the caller
 * renders it conditionally) — the initial state comes from the props.
 */
export function MarkerDialog({
  onClose,
  frame,
  startFrame,
  editing,
  api,
}: {
  onClose: () => void;
  /** Target frame (creation) — ignored when editing. */
  frame: number;
  startFrame: number;
  /** Marker being edited (null = creation). */
  editing: TimelineMarker | null;
  api: TimelineMarkersApi;
}) {
  const tr = useT();
  const [name, setName] = useState(editing?.name ?? '');
  const [color, setColor] = useState(editing?.color ?? MARKER_COLORS[0]);

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
            {editing
              ? tr('marker.edit')
              : tr('marker.atFrame', { frame: startFrame + (editing ? 0 : frame) })}
          </DialogTitle>
        </DialogHeader>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void submit()}
          placeholder={tr('review.marker.placeholder')}
          aria-label={tr('review.marker.placeholder')}
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
            {tr('common.cancel')}
          </Button>
          <Button onClick={() => void submit()} disabled={!name.trim()}>
            {editing ? tr('common.edit') : tr('common.add')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
