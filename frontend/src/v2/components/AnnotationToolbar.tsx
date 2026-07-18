import { useEffect, useRef, useState } from 'react';
import { Circle, Eraser, Hand, MoveUpRight, Pencil, Redo2, Square, Type, Undo2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import ColorPicker from './ColorPicker';
import { arrowHead, textFontSize } from './annotation/geometry';
import type { Tool } from './AnnotationCanvas';

const TOOL_ICONS: { id: Tool; icon: LucideIcon; title: string }[] = [
  { id: 'draw', icon: Pencil, title: 'Dessin libre' },
  { id: 'rect', icon: Square, title: 'Rectangle' },
  { id: 'ellipse', icon: Circle, title: 'Ellipse' },
  { id: 'arrow', icon: MoveUpRight, title: 'Flèche' },
  { id: 'text', icon: Type, title: 'Texte' },
  { id: 'move', icon: Hand, title: 'Déplacer une forme' },
  { id: 'erase', icon: Eraser, title: 'Gomme (clic ou glisser)' },
];

/**
 * Aperçu plein écran de la taille réelle des outils : affiché pendant le réglage de
 * l'épaisseur, chaque outil est dessiné **à la taille qu'il aura sur le canvas**
 * (traits en px écran — `vector-effect: non-scaling-stroke` côté canvas).
 */
function ToolSizePreview({ width, color, alpha }: { width: number; color: string; alpha: number }) {
  const W = 520,
    H = 150,
    midY = H / 2;
  // Taille du texte : fraction de la hauteur du média — approximée par la hauteur
  // typique du viewer (l'aperçu est indicatif, le canvas fait foi).
  const fontPx = textFontSize(width) * window.innerHeight * 0.6;
  const head = arrowHead(300 / W, midY / H, 385 / W, midY / H, { w: W, h: H }, width);
  const stroke = { stroke: color, strokeOpacity: alpha, strokeWidth: width, fill: 'none' } as const;
  return (
    <div className="pointer-events-none fixed inset-0 z-[70] flex items-center justify-center">
      <div className="rounded-lg border border-border bg-background/90 px-6 py-4 shadow-2xl backdrop-blur">
        <svg width={W} height={H}>
          {/* Trait libre */}
          <path
            d={`M 20 ${midY + 25} C 45 ${midY - 35}, 70 ${midY + 35}, 95 ${midY - 25}`}
            {...stroke}
            strokeLinecap="round"
          />
          {/* Rectangle */}
          <rect x={125} y={midY - 30} width={70} height={60} {...stroke} strokeLinejoin="round" />
          {/* Ellipse */}
          <ellipse cx={255} cy={midY} rx={35} ry={30} {...stroke} />
          {/* Flèche */}
          {head && (
            <>
              <line
                x1={300}
                y1={midY}
                x2={head.shaftEnd[0] * W}
                y2={head.shaftEnd[1] * H}
                {...stroke}
                strokeLinecap="round"
              />
              <path
                d={`M ${head.tip[0] * W} ${head.tip[1] * H} L ${head.left[0] * W} ${head.left[1] * H} L ${head.right[0] * W} ${head.right[1] * H} Z`}
                fill={color}
                fillOpacity={alpha}
                stroke={color}
                strokeOpacity={alpha}
                strokeWidth={width}
                strokeLinejoin="round"
              />
            </>
          )}
          {/* Texte */}
          <text
            x={415}
            y={midY}
            fill={color}
            fillOpacity={alpha}
            fontSize={fontPx}
            fontFamily="ui-sans-serif, system-ui, sans-serif"
            dominantBaseline="middle"
          >
            Aa
          </text>
        </svg>
        <p className="mt-1 text-center text-xs text-muted-foreground">
          Taille réelle des outils — épaisseur {width}px
        </p>
      </div>
    </div>
  );
}

/** Palette d'annotation : outils, couleur/opacité, épaisseur (avec aperçu taille réelle),
 * undo/redo, effacer. */
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
  const [previewOpen, setPreviewOpen] = useState(false);
  const previewTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(previewTimer.current), []);

  // L'aperçu reste visible pendant le réglage, puis disparaît peu après.
  const pokePreview = () => {
    setPreviewOpen(true);
    window.clearTimeout(previewTimer.current);
    previewTimer.current = window.setTimeout(() => setPreviewOpen(false), 900);
  };

  return (
    <div className="relative flex flex-wrap items-center gap-1.5 rounded-md border border-border bg-card p-1.5 text-sm">
      {/* type=button partout : la palette vit DANS le <form> du composer — un bouton
          sans type y vaut submit et enverrait le commentaire au choix d'un outil. */}
      {TOOL_ICONS.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => setTool(t.id)}
          title={t.title}
          className={`flex h-8 w-8 items-center justify-center rounded ${tool === t.id ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
        >
          <t.icon size={16} />
        </button>
      ))}
      <span className="mx-1 h-6 w-px bg-border" />
      {/* Pastille couleur courante → ouvre le sélecteur indépendant du navigateur */}
      <button
        type="button"
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
        onChange={(e) => {
          setWidth(Number(e.target.value));
          pokePreview();
        }}
        onPointerDown={pokePreview}
        title="Épaisseur (aperçu taille réelle pendant le réglage)"
        className="w-20"
      />
      <span className="mx-1 h-6 w-px bg-border" />
      <button
        type="button"
        onClick={onUndo}
        disabled={!canUndo}
        title="Annuler"
        className="h-8 rounded px-2 hover:bg-muted disabled:opacity-40"
      >
        <Undo2 size={15} />
      </button>
      <button
        type="button"
        onClick={onRedo}
        disabled={!canRedo}
        title="Rétablir"
        className="h-8 rounded px-2 hover:bg-muted disabled:opacity-40"
      >
        <Redo2 size={15} />
      </button>
      <button type="button" onClick={onClear} className="h-8 rounded px-2 hover:bg-muted">
        Effacer
      </button>
      {previewOpen && <ToolSizePreview width={width} color={color} alpha={alpha} />}
    </div>
  );
}
