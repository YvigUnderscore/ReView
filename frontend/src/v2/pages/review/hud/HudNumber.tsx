import { useRef, useState, type ReactNode } from 'react';
import { clampValue, dragValue, formatValue, parseInput, type HudNumberSpec } from './hudNumberMath';

/**
 * Champ numérique « drag-label » du HUD (Phase 17) — remplace les sliders : glisser
 * horizontalement sur la valeur pour l'ajuster (Maj = ×10), double-clic pour saisir au clavier
 * (Entrée valide, Échap annule). Pattern DCC/Blender : compact, précis, lisible.
 */
export default function HudNumber({
  label,
  hint,
  value,
  onChange,
  min,
  max,
  step,
  pixelsPerStep,
  unit,
}: {
  /** Libellé court (ou icône) affiché devant la valeur. */
  label: ReactNode;
  hint: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  pixelsPerStep?: number;
  unit?: string;
}) {
  const spec: HudNumberSpec = { min, max, step, pixelsPerStep };
  const [editing, setEditing] = useState(false);
  const drag = useRef<{ pointerId: number; startX: number; startValue: number; moved: boolean } | null>(null);

  const commitInput = (text: string) => {
    const v = parseInput(text);
    if (v != null) onChange(clampValue(v, spec));
    setEditing(false);
  };

  if (editing) {
    return (
      <label className="flex items-center gap-1 text-muted-foreground" title={hint}>
        {label}
        <input
          autoFocus
          defaultValue={formatValue(value, step)}
          onFocus={(e) => e.currentTarget.select()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitInput(e.currentTarget.value);
            else if (e.key === 'Escape') setEditing(false);
          }}
          onBlur={(e) => commitInput(e.currentTarget.value)}
          className="w-14 rounded border border-primary bg-background/80 px-1 py-0.5 text-right font-mono text-[11px] text-foreground outline-none"
        />
      </label>
    );
  }

  return (
    <span
      className="flex items-center gap-1 text-muted-foreground"
      title={`${hint} — glisser pour ajuster (Maj ×10), double-clic pour saisir`}
    >
      {label}
      <button
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          drag.current = { pointerId: e.pointerId, startX: e.clientX, startValue: value, moved: false };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d || d.pointerId !== e.pointerId) return;
          const dx = e.clientX - d.startX;
          if (Math.abs(dx) > 2) d.moved = true;
          if (d.moved) onChange(dragValue(d.startValue, dx, spec, e.shiftKey ? 10 : 1));
        }}
        onPointerUp={(e) => {
          if (drag.current?.pointerId === e.pointerId) drag.current = null;
        }}
        onDoubleClick={() => setEditing(true)}
        className="min-w-10 cursor-ew-resize select-none rounded border border-border bg-background/60 px-1.5 py-0.5 text-right font-mono text-[11px] text-foreground hover:border-primary/60"
      >
        {formatValue(value, step)}
        {unit && <span className="ml-0.5 text-muted-foreground">{unit}</span>}
      </button>
    </span>
  );
}
