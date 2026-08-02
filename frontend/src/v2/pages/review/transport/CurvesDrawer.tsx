// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useMemo, useRef, useState } from 'react';
import { isEditable } from '../../../lib/shortcuts';
import { CHANNEL_IDS, type ChannelId } from '../camera/channels/model';
import type { CameraAnimState } from '../camera/useCameraAnim';
import ChannelList from '../camera/timeline/ChannelList';
import CurveCanvas from '../camera/timeline/CurveCanvas';
import { fitValueRange, zoomTime, type TimeView } from '../camera/timeline/viewTransform';

/** Hauteur du tiroir et largeur de la colonne de canaux — valeurs du chrome de review. */
const DRAWER_HEIGHT = 168;

/**
 * Tiroir « Courbes » ancré sous le transport : le graph editor de l'animation caméra, qui
 * flottait jusqu'ici dans une fenêtre déplaçable (`AnimPanel`). Même éditeur, mêmes gestes
 * (scrub, sélection, tangentes, zoom molette) et mêmes raccourcis — il ne recouvre plus la
 * scène et n'a plus besoin d'être déplacé pour voir ce qu'on anime.
 */
export default function CurvesDrawer({ anim, editable }: { anim: CameraAnimState; editable: boolean }) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [graph, setGraph] = useState({ w: 400, h: DRAWER_HEIGHT });
  // Fenêtre temporelle : `null` = ajustée à la durée ; un zoom/pan pose un override.
  const [override, setOverride] = useState<{ t0: number; t1: number } | null>(null);
  const [hidden, setHidden] = useState<ReadonlySet<ChannelId>>(new Set());

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setGraph({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setGraph({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // Clés : Suppr supprime la sélection, Ctrl/⌘+C copie, Ctrl/⌘+V colle à la tête de lecture.
  useEffect(() => {
    if (!editable) return;
    const onKey = (e: KeyboardEvent) => {
      if (isEditable(e.target) || document.querySelector('[role="dialog"]')) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && anim.selection.length) {
        e.preventDefault();
        anim.removeSelection();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C') && anim.selection.length) {
        e.preventDefault();
        anim.copySelection();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'v' || e.key === 'V') && anim.canPaste) {
        e.preventDefault();
        anim.paste();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editable, anim]);

  const keyedChannels = useMemo(() => {
    const s = new Set<ChannelId>();
    for (const id of CHANNEL_IDS) if (anim.anim.channels[id]?.keys.length) s.add(id);
    return s;
  }, [anim.anim]);
  const visible = useMemo(() => {
    const s = new Set<ChannelId>();
    for (const id of keyedChannels) if (!hidden.has(id)) s.add(id);
    return s;
  }, [keyedChannels, hidden]);
  const valueRange = useMemo(() => {
    const values: number[] = [];
    for (const id of visible) for (const k of anim.anim.channels[id]?.keys ?? []) values.push(k.v);
    return fitValueRange(values);
  }, [visible, anim.anim]);

  const timeView: TimeView = {
    ...(override ?? { t0: 0, t1: Math.max(anim.playDuration * 1.1, 3000) }),
    width: graph.w,
  };

  return (
    <div className="flex flex-shrink-0 border-t border-border bg-card" style={{ height: DRAWER_HEIGHT }}>
      <ChannelList
        keyedChannels={keyedChannels}
        visible={visible}
        onToggle={(id) =>
          setHidden((h) => {
            const n = new Set(h);
            if (n.has(id)) n.delete(id);
            else n.add(id);
            return n;
          })
        }
      />
      <div ref={bodyRef} className="relative min-w-0 flex-1 overflow-hidden pl-1">
        <CurveCanvas
          anim={anim.anim}
          visible={visible}
          timeView={timeView}
          valueView={{ ...valueRange, height: graph.h }}
          playheadT={anim.timeMs}
          selection={anim.selection}
          editable={editable}
          width={graph.w}
          height={graph.h}
          guideT={
            anim.anim.durationMs && anim.anim.durationMs > 0
              ? anim.anim.durationMs
              : anim.duration || undefined
          }
          onZoom={(pivotT, factor) => setOverride(zoomTime(timeView, pivotT, factor))}
          onScrub={anim.scrub}
          onSelect={anim.setSelection}
          onBeginStroke={anim.beginStroke}
          onMoveKeys={anim.strokeMoveKeys}
          onSetTangent={anim.strokeSetTangent}
          onAddKey={anim.addKey}
        />
      </div>
    </div>
  );
}
