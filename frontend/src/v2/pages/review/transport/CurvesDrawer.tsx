// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useMemo, useRef, useState } from 'react';
import { Maximize2 } from 'lucide-react';
import { isEditable } from '../../../lib/shortcuts';
import { CHANNEL_IDS, type ChannelId, type TangentMode } from '../camera/channels/model';
import type { CameraAnimState } from '../camera/useCameraAnim';
import ChannelList from '../camera/timeline/ChannelList';
import CurveCanvas from '../camera/timeline/CurveCanvas';
import TimeRuler, { RULER_HEIGHT } from '../camera/timeline/TimeRuler';
import { fitValueRange, panTime, zoomTime, type TimeView } from '../camera/timeline/viewTransform';
import { DRAWER_DEFAULT_H, DRAWER_MAX_H, DRAWER_MIN_H } from '../chrome/chromeState';
import { useT } from '../../../i18n';

/** Modes de tangente applicables à la sélection de clés (segmented flottant du graph editor). */
function TangentModeBar({
  current,
  onMode,
}: {
  current: TangentMode | undefined;
  onMode: (m: TangentMode) => void;
}) {
  const t = useT();
  const labels: Record<TangentMode, string> = {
    auto: t('camera.tangent.auto'),
    linear: t('camera.tangent.linear'),
    step: t('camera.tangent.step'),
    free: t('camera.tangent.free'),
  };
  return (
    <div className="absolute top-1 right-2 z-10 flex overflow-hidden rounded border border-border bg-card/90 text-2xs">
      {(['auto', 'linear', 'step', 'free'] as const).map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => onMode(m)}
          className={`px-1.5 py-0.5 transition-colors ${
            current === m
              ? 'bg-primary/15 text-primary'
              : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground'
          }`}
        >
          {labels[m]}
        </button>
      ))}
    </div>
  );
}

/**
 * Tiroir « Courbes » ancré sous le transport : le séquenceur de l'animation caméra — règle
 * temporelle graduée (scrub au drag, timecode `s:ff`) au-dessus du graph editor, **même échelle
 * horizontale** pour les deux (les clés restent alignées verticalement). Zoom molette partout,
 * pan Maj+molette, bouton Fit pour recadrer la fenêtre sur l'animation, hauteur redimensionnable
 * par le bord supérieur (persistée avec les préférences du chrome).
 */
export default function CurvesDrawer({
  anim,
  editable,
  fps,
  height = DRAWER_DEFAULT_H,
  onHeight,
  onOrbitPreset,
}: {
  anim: CameraAnimState;
  editable: boolean;
  /** Framerate du pipeline (snap du scrub à la frame, timecode). */
  fps: number;
  /** Hauteur persistée du tiroir (préférences du chrome). */
  height?: number;
  onHeight?: (h: number) => void;
  /** Preset orbite proposé dans l'état vide (gestionnaire). */
  onOrbitPreset?: () => void;
}) {
  const t = useT();
  const bodyRef = useRef<HTMLDivElement>(null);
  const [graph, setGraph] = useState({ w: 400, h: height - RULER_HEIGHT });
  const resize = useRef<{ y0: number; h0: number } | null>(null);
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
  const guideT =
    anim.anim.durationMs && anim.anim.durationMs > 0 ? anim.anim.durationMs : anim.duration || undefined;
  const zoomAt = (pivotT: number, factor: number) => setOverride(zoomTime(timeView, pivotT, factor));

  return (
    <div className="relative flex flex-shrink-0 flex-col border-t border-border bg-card" style={{ height }}>
      {onHeight && (
        <div
          className="absolute inset-x-0 -top-1 z-10 h-2 touch-none"
          style={{ cursor: 'ns-resize' }}
          onPointerDown={(e) => {
            resize.current = { y0: e.clientY, h0: height };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            const r = resize.current;
            if (r) onHeight(Math.min(DRAWER_MAX_H, Math.max(DRAWER_MIN_H, r.h0 + (r.y0 - e.clientY))));
          }}
          onPointerUp={(e) => {
            resize.current = null;
            e.currentTarget.releasePointerCapture?.(e.pointerId);
          }}
        />
      )}
      <div className="flex shrink-0 border-b border-border/60" style={{ height: RULER_HEIGHT }}>
        <div className="flex w-24 shrink-0 items-center justify-end border-r border-border pr-1">
          <button
            type="button"
            title={t('camera.fitView')}
            aria-label={t('camera.fitView')}
            onClick={() => setOverride(null)}
            className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
          >
            <Maximize2 size={12} />
          </button>
        </div>
        <div className="relative min-w-0 flex-1 overflow-hidden pl-1">
          <TimeRuler
            view={timeView}
            fps={fps}
            keyTimes={anim.keyTimes}
            playheadT={anim.timeMs}
            guideT={guideT}
            editable={editable}
            onScrub={anim.scrub}
            onZoom={zoomAt}
            onBeginStroke={anim.beginStroke}
            onMoveColumn={anim.strokeMoveColumn}
            onRemoveColumn={anim.removeColumn}
          />
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
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
          editable={editable}
          onKeyChannel={(id) => anim.insertChannelKeyAtView(id)}
        />
        <div ref={bodyRef} className="relative min-w-0 flex-1 overflow-hidden pl-1">
          {editable && anim.selection.length > 0 && (
            <TangentModeBar
              current={(() => {
                const p = anim.selection[anim.selection.length - 1];
                return p ? anim.anim.channels[p.channel]?.keys[p.index]?.mode : undefined;
              })()}
              onMode={anim.setSelectionMode}
            />
          )}
          {anim.keyTimes.length === 0 && (
            <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 px-4 text-center text-xs text-muted-foreground">
              <span>{t(editable ? 'camera.empty.editable' : 'camera.empty')}</span>
              {editable && onOrbitPreset && (
                <button
                  type="button"
                  onClick={onOrbitPreset}
                  className="pointer-events-auto rounded border border-border px-2 py-0.5 text-xs transition-colors hover:bg-secondary/60 hover:text-foreground"
                >
                  {t('camera.orbitPreset')}
                </button>
              )}
            </div>
          )}
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
            guideT={guideT}
            onZoom={zoomAt}
            onPan={(deltaMs) => setOverride(panTime(timeView, deltaMs))}
            onScrub={anim.scrub}
            onSelect={anim.setSelection}
            onBeginStroke={anim.beginStroke}
            onMoveKeys={anim.strokeMoveKeys}
            onSetTangent={anim.strokeSetTangent}
            onAddKey={anim.addKey}
          />
        </div>
      </div>
    </div>
  );
}
