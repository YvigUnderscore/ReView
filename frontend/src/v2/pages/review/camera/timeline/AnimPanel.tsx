import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { CHANNEL_IDS, type ChannelId } from '../channels/model';
import type { CameraAnimState } from '../useCameraAnim';
import { downloadAnimGltf } from '../../three/exportCameraGltf';
import AnimToolbar, { type AnimEditMode } from './AnimToolbar';
import ChannelList from './ChannelList';
import CurveCanvas from './CurveCanvas';
import DopeSheet from './DopeSheet';
import { fitValueRange, zoomTime, type TimeView } from './viewTransform';

const BODY_H = 176; // hauteur du corps de l'éditeur (px)

/**
 * Panneau de l'éditeur d'animation caméra (Phase 17) : barre d'outils (transport, pose de clé,
 * presets, glTF, présentation) + corps repliable **dopesheet** (timing) ou **graph editor**
 * (F-curves, clés/tangentes déplaçables à la main, façon logiciel 3D). Remplace `KeyframeTimeline`.
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
  onOrbitPreset: () => void;
  onImport?: (file: File) => void;
  onAttach?: () => void;
  onSave?: () => void;
  onClear?: () => void;
  busy?: boolean;
  editable: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<AnimEditMode>('graph');
  // Fenêtre temporelle : `null` = ajustée automatiquement à la durée ; un zoom/pan pose un override.
  const [override, setOverride] = useState<{ t0: number; t1: number } | null>(null);
  const [hidden, setHidden] = useState<ReadonlySet<ChannelId>>(new Set());
  const bodyRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 400, h: BODY_H });

  const duration = anim.duration;
  const timeWindow = override ?? { t0: 0, t1: Math.max(duration * 1.1, 3000) };

  // Mesure du corps (largeur du tracé, hauteur du graph).
  useEffect(() => {
    const el = bodyRef.current;
    if (!el || !open) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, [open]);

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

  const timeView: TimeView = { ...timeWindow, width: size.w };

  return (
    <div className="pointer-events-auto w-[min(680px,80vw)] rounded-md border border-border bg-card/90 px-2 py-1.5 text-xs shadow-sm backdrop-blur">
      <div className="flex items-center gap-2">
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
            mode={mode}
            onMode={setMode}
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
        <div className="mt-1.5 flex border-t border-border pt-1.5" style={{ height: BODY_H }}>
          {mode === 'graph' && (
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
          )}
          <div ref={bodyRef} className="relative min-w-0 flex-1 overflow-hidden pl-1">
            {mode === 'dope' ? (
              <DopeSheet
                anim={anim.anim}
                view={timeView}
                playheadT={anim.timeMs}
                selectedTime={
                  anim.selection
                    ? (anim.anim.channels[anim.selection.channel]?.keys[anim.selection.index]?.t ?? null)
                    : null
                }
                editable={editable}
                onScrub={anim.scrub}
                onMoveColumn={anim.shiftColumn}
                onSelectTime={(t) => anim.setSelection(t == null ? null : findKeyAtTime(anim, t))}
                onInsertAt={anim.insertKeyAtView}
              />
            ) : (
              <CurveCanvas
                anim={anim.anim}
                visible={visible}
                timeView={timeView}
                valueView={{ ...valueRange, height: size.h }}
                playheadT={anim.timeMs}
                selection={anim.selection}
                editable={editable}
                width={size.w}
                height={size.h}
                onZoom={(pivotT, factor) => setOverride(zoomTime(timeView, pivotT, factor))}
                onScrub={anim.scrub}
                onSelect={anim.setSelection}
                onBeginStroke={anim.beginStroke}
                onMoveKey={anim.strokeMoveKey}
                onSetTangent={anim.strokeSetTangent}
                onAddKey={anim.addKey}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Première clé au temps `t` (pour sélectionner une colonne dopesheet). */
function findKeyAtTime(anim: CameraAnimState, t: number): { channel: ChannelId; index: number } | null {
  for (const id of CHANNEL_IDS) {
    const idx = anim.anim.channels[id]?.keys.findIndex((k) => k.t === t) ?? -1;
    if (idx >= 0) return { channel: id, index: idx };
  }
  return null;
}
