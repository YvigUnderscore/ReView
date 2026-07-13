import { useRef } from 'react';
import { animKeyTimes, type CameraAnimV2 } from '../channels/model';
import { timeToX, xToTime, type TimeView } from './viewTransform';

/**
 * Dopesheet (Phase 17) : chaque colonne = un temps de clé (tous canaux confondus), en losange
 * **déplaçable horizontalement** pour retimer, sélectionnable, supprimable (bouton/Suppr).
 * Double-clic sur le rail vide = poser une clé depuis la vue courante à ce temps. Le playhead
 * (barre verticale) suit la lecture et se déplace au clic/glisser sur le rail.
 */
export default function DopeSheet({
  anim,
  view,
  playheadT,
  selectedTime,
  editable,
  onScrub,
  onMoveColumn,
  onSelectTime,
  onInsertAt,
}: {
  anim: CameraAnimV2;
  view: TimeView;
  playheadT: number;
  selectedTime: number | null;
  editable: boolean;
  onScrub: (t: number) => void;
  onMoveColumn: (t: number, delta: number) => void;
  onSelectTime: (t: number | null) => void;
  onInsertAt: (t: number) => void;
}) {
  const times = animKeyTimes(anim);
  const railRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ time: number; startX: number; moved: boolean } | null>(null);

  const railTime = (clientX: number) => {
    const rect = railRef.current?.getBoundingClientRect();
    return rect ? Math.max(0, xToTime(clientX - rect.left, view)) : 0;
  };

  return (
    <div className="relative min-w-0 flex-1">
      <div
        ref={railRef}
        className="relative h-full w-full cursor-text"
        onPointerDown={(e) => {
          if (e.target === e.currentTarget) onScrub(railTime(e.clientX));
        }}
        onDoubleClick={(e) => {
          if (editable && e.target === e.currentTarget) onInsertAt(railTime(e.clientX));
        }}
      >
        {/* Playhead */}
        <div
          className="pointer-events-none absolute top-0 h-full w-px bg-primary"
          style={{ left: timeToX(playheadT, view) }}
        />
        {/* Colonnes de clés */}
        {times.map((t) => {
          const x = timeToX(t, view);
          if (x < -6 || x > view.width + 6) return null;
          const selected = selectedTime === t;
          return (
            <div
              key={t}
              className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
              style={{ left: x }}
              onPointerDown={(e) => {
                e.stopPropagation();
                onSelectTime(t);
                if (!editable) return;
                drag.current = { time: t, startX: e.clientX, moved: false };
                (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
              }}
              onPointerMove={(e) => {
                const d = drag.current;
                if (d && Math.abs(e.clientX - d.startX) > 2) d.moved = true;
              }}
              onPointerUp={(e) => {
                const d = drag.current;
                drag.current = null;
                if (d?.moved) {
                  const delta = xToTime(e.clientX, view) - xToTime(d.startX, view);
                  onMoveColumn(d.time, Math.round(delta));
                }
              }}
              title={`${(t / 1000).toFixed(2)} s`}
            >
              <span
                className={`block h-2.5 w-2.5 rotate-45 border ${
                  selected ? 'border-primary bg-primary' : 'border-foreground/70 bg-card'
                } ${editable ? 'cursor-ew-resize' : ''}`}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
