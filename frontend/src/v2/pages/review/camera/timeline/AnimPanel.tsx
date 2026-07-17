import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, GripVertical } from 'lucide-react';
import { isEditable } from '../../../../lib/shortcuts';
import { CHANNEL_IDS, type ChannelId } from '../channels/model';
import type { CameraAnimState } from '../useCameraAnim';
import { downloadAnimGltf } from '../../three/exportCameraGltf';
import AnimToolbar from './AnimToolbar';
import ChannelList from './ChannelList';
import CurveCanvas from './CurveCanvas';
import { fitValueRange, zoomTime, type TimeView } from './viewTransform';

const STORE_KEY = 'review.animPanel.size';
const MIN_W = 360;
const MIN_H = 120;

/** Taille persistée du corps de l'éditeur (largeur du panneau, hauteur du graphe). */
function loadSize(): { w: number; h: number } {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const s = JSON.parse(raw) as { w: number; h: number };
      if (s.w >= MIN_W && s.h >= MIN_H) return s;
    }
  } catch {
    /* défaut */
  }
  return { w: 560, h: 200 };
}

/**
 * Panneau de l'éditeur d'animation caméra (Phase 17/27) : barre d'outils (transport, auto-key,
 * durée, presets, glTF, présentation) + **graph editor** unique (dopesheet retiré). Fenêtre
 * **déplaçable** (poignée d'en-tête) et **redimensionnable** (coin bas-droit), taille persistée.
 * Écriture réservée au gestionnaire pré-publish (`editable`) ; sinon transport + scrub seuls.
 */
export default function AnimPanel({
  anim,
  onOrbitPreset,
  onImport,
  onAttach,
  onSave,
  onClear,
  busy,
  editable,
}: {
  anim: CameraAnimState;
  onOrbitPreset: (radiusScale?: number) => void;
  onImport?: (file: File) => void;
  onAttach?: () => void;
  onSave?: () => void;
  onClear?: () => void;
  busy?: boolean;
  editable: boolean;
}) {
  const [open, setOpen] = useState(false);
  // Fenêtre temporelle : `null` = ajustée automatiquement à la durée ; un zoom/pan pose un override.
  const [override, setOverride] = useState<{ t0: number; t1: number } | null>(null);
  const [hidden, setHidden] = useState<ReadonlySet<ChannelId>>(new Set());
  const [panelSize, setPanelSize] = useState(loadSize);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const bodyRef = useRef<HTMLDivElement>(null);
  const [graph, setGraph] = useState({ w: 400, h: panelSize.h });

  const duration = anim.duration;
  const timeWindow = override ?? { t0: 0, t1: Math.max(anim.playDuration * 1.1, 3000) };

  // Mesure de l'aire de tracé (largeur/hauteur SVG) — s'adapte au redimensionnement du panneau.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el || !open) return;
    const ro = new ResizeObserver(() => setGraph({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setGraph({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, [open, panelSize]);

  // Suppression des clés sélectionnées (Suppr) — quand l'éditeur est ouvert et éditable.
  useEffect(() => {
    if (!open || !editable) return;
    const onKey = (e: KeyboardEvent) => {
      if (isEditable(e.target) || document.querySelector('[role="dialog"]')) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && anim.selection.length) {
        e.preventDefault();
        anim.removeSelection();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, editable, anim]);

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

  const timeView: TimeView = { ...timeWindow, width: graph.w };

  // Déplacement de la fenêtre (poignée d'en-tête) : translate, sans reflow du HUD.
  const startDrag = (e: React.PointerEvent) => {
    const start = { x: e.clientX - offset.x, y: e.clientY - offset.y };
    const move = (ev: PointerEvent) => setOffset({ x: ev.clientX - start.x, y: ev.clientY - start.y });
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // Redimensionnement (coin bas-droit) : largeur du panneau + hauteur du graphe, persistées.
  const startResize = (e: React.PointerEvent) => {
    e.stopPropagation();
    const start = { x: e.clientX, y: e.clientY, w: panelSize.w, h: panelSize.h };
    const move = (ev: PointerEvent) =>
      setPanelSize({
        w: Math.max(MIN_W, start.w + (ev.clientX - start.x)),
        h: Math.max(MIN_H, start.h + (ev.clientY - start.y)),
      });
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setPanelSize((s) => {
        try {
          localStorage.setItem(STORE_KEY, JSON.stringify(s));
        } catch {
          /* ignore */
        }
        return s;
      });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div
      className="pointer-events-auto relative rounded-md border border-border bg-card/90 px-2 py-1.5 text-xs shadow-sm backdrop-blur"
      style={{ width: open ? panelSize.w : undefined, transform: `translate(${offset.x}px, ${offset.y}px)` }}
    >
      <div className="flex items-center gap-2">
        {open && (
          <span
            onPointerDown={startDrag}
            title="Déplacer la fenêtre"
            className="cursor-grab text-muted-foreground active:cursor-grabbing"
          >
            <GripVertical size={14} />
          </span>
        )}
        <button
          onClick={() => setOpen((o) => !o)}
          title={open ? "Replier l'éditeur" : "Déplier l'éditeur d'animation"}
          className="flex items-center justify-center rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          {open ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </button>
        <div className="min-w-0 flex-1">
          <AnimToolbar
            anim={anim}
            onOrbitPreset={onOrbitPreset}
            onImport={onImport}
            onExport={() => void downloadAnimGltf(anim.anim)}
            onAttach={onAttach}
            onSave={onSave}
            onClear={onClear}
            busy={busy}
            editable={editable}
          />
        </div>
      </div>

      {open && (
        <div className="mt-1.5 flex border-t border-border pt-1.5" style={{ height: panelSize.h }}>
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
                  : duration || undefined
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
      )}

      {open && (
        <span
          onPointerDown={startResize}
          title="Redimensionner"
          className="absolute bottom-0 right-0 h-3 w-3 cursor-nwse-resize border-b-2 border-r-2 border-muted-foreground/50"
        />
      )}
    </div>
  );
}
