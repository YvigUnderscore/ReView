import { useState } from 'react';
import ColorPicker from './ColorPicker';
import type { Tool } from './AnnotationCanvas';

const TOOL_ICONS: { id: Tool; label: string }[] = [
  { id: 'draw', label: '✏️' },
  { id: 'rect', label: '▭' },
  { id: 'ellipse', label: '◯' },
  { id: 'arrow', label: '↗' },
  { id: 'move', label: '✋' },
  { id: 'erase', label: '⌫' },
];

/** Palette d'annotation : outils, couleur/opacité, épaisseur, undo/redo, effacer. */
export function AnnotationToolbar({
  tool,
  setTool,
  color,
  setColor,
  width,
  setWidth,
  alpha,
  setAlpha,
  onUndo,
  onRedo,
  onClear,
  canUndo,
  canRedo,
}: {
  tool: Tool;
  setTool: (t: Tool) => void;
  color: string;
  setColor: (c: string) => void;
  width: number;
  setWidth: (w: number) => void;
  alpha: number;
  setAlpha: (a: number) => void;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
  canUndo: boolean;
  canRedo: boolean;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  return (
    <div className="relative flex flex-wrap items-center gap-1.5 rounded-md border border-border bg-card p-1.5 text-sm">
      {TOOL_ICONS.map((t) => (
        <button
          key={t.id}
          onClick={() => setTool(t.id)}
          title={t.id}
          className={`h-8 w-8 rounded ${tool === t.id ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
        >
          {t.label}
        </button>
      ))}
      <span className="mx-1 h-6 w-px bg-border" />
      {/* Pastille couleur courante → ouvre le sélecteur indépendant du navigateur */}
      <button
        onClick={() => setPickerOpen((o) => !o)}
        title="Couleur & opacité"
        className="h-7 w-7 rounded-full border border-border"
        style={{ background: `linear-gradient(${color}, ${color})`, opacity: 1 }}
      >
        <span className="block h-full w-full rounded-full" style={{ background: color, opacity: alpha }} />
      </button>
      {pickerOpen && (
        <div className="absolute left-0 top-full z-30 mt-1">
          <ColorPicker
            color={color}
            alpha={alpha}
            onChange={(c, a) => {
              setColor(c);
              setAlpha(a);
            }}
          />
        </div>
      )}
      <span className="mx-1 h-6 w-px bg-border" />
      <input
        type="range"
        min={1}
        max={12}
        value={width}
        onChange={(e) => setWidth(Number(e.target.value))}
        title="Épaisseur"
        className="w-20"
      />
      <span className="mx-1 h-6 w-px bg-border" />
      <button
        onClick={onUndo}
        disabled={!canUndo}
        className="h-8 rounded px-2 hover:bg-muted disabled:opacity-40"
      >
        ↶
      </button>
      <button
        onClick={onRedo}
        disabled={!canRedo}
        className="h-8 rounded px-2 hover:bg-muted disabled:opacity-40"
      >
        ↷
      </button>
      <button onClick={onClear} className="h-8 rounded px-2 hover:bg-muted">
        Effacer
      </button>
    </div>
  );
}
