import { useRef, useState, useCallback, useEffect } from 'react';

/**
 * Overlay d'annotation 2D (SVG, coordonnées normalisées 0..1 → suit la taille du média).
 * Outils : dessin libre, rectangle, ellipse, flèche, texte, gomme (clic forme), déplacement.
 * Couleurs + épaisseur, undo/redo, effacer tout. Contrôlé : `shapes` + `onChange`.
 * En lecture seule (`editable=false`), affiche les formes fournies sans interaction.
 */
export type Tool = 'draw' | 'rect' | 'ellipse' | 'arrow' | 'text' | 'move' | 'erase';

export interface Shape {
  id: string;
  type: 'path' | 'rect' | 'ellipse' | 'arrow' | 'text';
  color: string;
  width: number;
  alpha?: number; // opacité 0..1 (défaut 1)
  pts?: number[][]; // path
  x?: number;
  y?: number;
  w?: number;
  h?: number; // rect (x/y = ancre du texte)
  cx?: number;
  cy?: number;
  rx?: number;
  ry?: number; // ellipse
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number; // arrow
  text?: string; // texte (10.G backlog : annotations avancées)
}

/** Hauteur de police normalisée (fraction de la hauteur du média) selon l'épaisseur choisie. */
const textFontSize = (width: number): number => 0.02 + width * 0.005;

const uid = () => Math.random().toString(36).slice(2, 9);

export function AnnotationCanvas({
  shapes,
  onChange,
  editable,
  tool,
  color,
  width,
  alpha = 1,
  margin = 0,
  captureAspect,
}: {
  shapes: Shape[];
  onChange?: (s: Shape[]) => void;
  editable: boolean;
  tool: Tool;
  color: string;
  width: number;
  alpha?: number;
  /** Marge (fraction) de zone dessinable AUTOUR du média (annotations hors-cadre). */
  margin?: number;
  /**
   * Ratio largeur/hauteur du viewer au moment de l'annotation (3D à focale fixe).
   * En lecture seule, l'axe X est rescalé autour du centre (sx = captureAspect/aspectActuel)
   * pour que le dessin se superpose correctement quelle que soit la taille du viewer
   * (la focale verticale étant fixe, l'axe Y reste inchangé).
   */
  captureAspect?: number;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [draft, setDraft] = useState<Shape | null>(null);
  const [textDraft, setTextDraft] = useState<{ x: number; y: number; value: string } | null>(null);
  const drag = useRef<{ id: string; ox: number; oy: number } | null>(null);
  const [aspect, setAspect] = useState(0);

  // Suit le ratio largeur/hauteur réel du canvas : correction d'aspect en lecture (3D)
  // et contre-échelle horizontale du texte (glyphes non déformés malgré le viewBox 1×1).
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      if (r.height > 0) setAspect(r.width / r.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // viewBox étendu : 0..1 = média, valeurs négatives / >1 = hors-cadre.
  const vbMin = -margin;
  const vbSize = 1 + 2 * margin;

  // Correction d'aspect (lecture seule) : compression/expansion horizontale autour du centre.
  const sx = !editable && captureAspect && aspect > 0 ? captureAspect / aspect : 1;
  const groupTransform = sx !== 1 ? `translate(${0.5 * (1 - sx)} 0) scale(${sx} 1)` : undefined;

  const pt = useCallback(
    (e: React.PointerEvent) => {
      const r = svgRef.current!.getBoundingClientRect();
      return [
        vbMin + ((e.clientX - r.left) / r.width) * vbSize,
        vbMin + ((e.clientY - r.top) / r.height) * vbSize,
      ] as [number, number];
    },
    [vbMin, vbSize],
  );

  const hit = (p: [number, number]): Shape | undefined => {
    // Test simple : proximité (path) ou bounding box (formes)
    const near = (a: number, b: number) => Math.abs(a - b) < 0.03;
    return [...shapes].reverse().find((s) => {
      if (s.type === 'path') return s.pts?.some(([x, y]) => Math.hypot(x - p[0], y - p[1]) < 0.03);
      if (s.type === 'rect')
        return (
          p[0] >= (s.x ?? 0) - 0.02 &&
          p[0] <= (s.x ?? 0) + (s.w ?? 0) + 0.02 &&
          p[1] >= (s.y ?? 0) - 0.02 &&
          p[1] <= (s.y ?? 0) + (s.h ?? 0) + 0.02
        );
      if (s.type === 'ellipse')
        return (
          Math.hypot(
            (p[0] - (s.cx ?? 0)) / ((s.rx ?? 0.01) + 0.02),
            (p[1] - (s.cy ?? 0)) / ((s.ry ?? 0.01) + 0.02),
          ) <= 1
        );
      if (s.type === 'arrow') return near(p[0], s.x2 ?? 0) && near(p[1], s.y2 ?? 0);
      if (s.type === 'text')
        // Zone approximative : de l'ancre vers la droite (le texte s'étend depuis son point).
        return p[0] >= (s.x ?? 0) - 0.02 && p[0] <= (s.x ?? 0) + 0.25 && Math.abs(p[1] - (s.y ?? 0)) <= 0.04;
      return false;
    });
  };

  const down = (e: React.PointerEvent) => {
    if (!editable) return;
    if (e.button !== 0) return; // clic milieu/droit : laisse le pan remonter au parent
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = pt(e);
    if (tool === 'erase') {
      const s = hit(p);
      if (s) onChange?.(shapes.filter((x) => x.id !== s.id));
      return;
    }
    if (tool === 'move') {
      const s = hit(p);
      if (s) drag.current = { id: s.id, ox: p[0], oy: p[1] };
      return;
    }
    if (tool === 'text') {
      // Un clic pose le point d'ancrage ; la saisie se fait dans l'input flottant.
      // preventDefault : sans lui, le focus par défaut du mousedown vole le focus de
      // l'input fraîchement monté → blur immédiat → saisie fermée avant de taper.
      e.preventDefault();
      commitTextDraft();
      setTextDraft({ x: p[0], y: p[1], value: '' });
      return;
    }
    const base = { id: uid(), color, width, alpha };
    if (tool === 'draw') setDraft({ ...base, type: 'path', pts: [p] });
    else if (tool === 'rect') setDraft({ ...base, type: 'rect', x: p[0], y: p[1], w: 0, h: 0 });
    else if (tool === 'ellipse') setDraft({ ...base, type: 'ellipse', cx: p[0], cy: p[1], rx: 0, ry: 0 });
    else if (tool === 'arrow') setDraft({ ...base, type: 'arrow', x1: p[0], y1: p[1], x2: p[0], y2: p[1] });
  };

  const move = (e: React.PointerEvent) => {
    if (!editable) return;
    const p = pt(e);
    if (drag.current) {
      const d = drag.current;
      const dx = p[0] - d.ox,
        dy = p[1] - d.oy;
      drag.current = { ...d, ox: p[0], oy: p[1] };
      onChange?.(shapes.map((s) => (s.id === d.id ? translate(s, dx, dy) : s)));
      return;
    }
    if (!draft) return;
    if (draft.type === 'path') setDraft({ ...draft, pts: [...(draft.pts ?? []), p] });
    else if (draft.type === 'rect')
      setDraft({ ...draft, w: p[0] - (draft.x ?? 0), h: p[1] - (draft.y ?? 0) });
    else if (draft.type === 'ellipse')
      setDraft({ ...draft, rx: Math.abs(p[0] - (draft.cx ?? 0)), ry: Math.abs(p[1] - (draft.cy ?? 0)) });
    else if (draft.type === 'arrow') setDraft({ ...draft, x2: p[0], y2: p[1] });
  };

  const up = () => {
    if (drag.current) {
      drag.current = null;
      return;
    }
    if (draft) {
      onChange?.([...shapes, normalizeRect(draft)]);
      setDraft(null);
    }
  };

  // Valide la saisie de texte en cours (Entrée, blur ou nouveau clic). Effet hors
  // updater : un setState parent dans un updater est illégal (double-invocation StrictMode).
  const commitTextDraft = () => {
    const value = textDraft?.value.trim();
    if (textDraft && value) {
      onChange?.([
        ...shapes,
        { id: uid(), type: 'text', color, width, alpha, x: textDraft.x, y: textDraft.y, text: value },
      ]);
    }
    setTextDraft(null);
  };

  const all = draft ? [...shapes, draft] : shapes;

  return (
    <>
      {editable && textDraft && (
        <TextDraftInput
          draft={textDraft}
          onChangeValue={(v) => setTextDraft((d) => (d ? { ...d, value: v } : d))}
          onCommit={commitTextDraft}
          onCancel={() => setTextDraft(null)}
        />
      )}
      <svg
        ref={svgRef}
        viewBox={`${vbMin} ${vbMin} ${vbSize} ${vbSize}`}
        preserveAspectRatio="none"
        className="absolute"
        style={{
          left: `${vbMin * 100}%`,
          top: `${vbMin * 100}%`,
          width: `${vbSize * 100}%`,
          height: `${vbSize * 100}%`,
          overflow: 'visible',
          pointerEvents: editable ? 'auto' : 'none',
          cursor: editable ? 'crosshair' : 'default',
          touchAction: 'none',
        }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
      >
        <defs>
          <marker id="arrowhead" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" fill="context-stroke" />
          </marker>
        </defs>
        <g transform={groupTransform}>
          {all.map((s) => (
            <ShapeEl key={s.id} s={s} textScaleX={aspect > 0 ? 1 / aspect : 1} />
          ))}
        </g>
      </svg>
    </>
  );
}

/** Input flottant de l'outil texte : HTML positionné en % du média (hors du SVG,
 * qui déformerait la saisie via son viewBox normalisé). Entrée valide, Échap annule. */
function TextDraftInput({
  draft,
  onChangeValue,
  onCommit,
  onCancel,
}: {
  draft: { x: number; y: number; value: string };
  onChangeValue: (v: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  return (
    <input
      // Focus différé : laisse passer l'action par défaut du clic d'origine avant de
      // prendre le focus (sinon le focus par défaut du mousedown le vole → blur → fermé).
      ref={(el) => {
        if (el) setTimeout(() => el.focus(), 0);
      }}
      value={draft.value}
      placeholder="Texte…"
      onChange={(e) => onChangeValue(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') onCommit();
        if (e.key === 'Escape') onCancel();
      }}
      onBlur={onCommit}
      onPointerDown={(e) => e.stopPropagation()}
      className="absolute z-10 w-48 rounded border border-primary bg-background/90 px-1.5 py-0.5 text-sm text-foreground focus:outline-none"
      style={{ left: `${draft.x * 100}%`, top: `${(draft.y - 0.02) * 100}%` }}
    />
  );
}

function translate(s: Shape, dx: number, dy: number): Shape {
  if (s.type === 'path') return { ...s, pts: s.pts?.map(([x, y]) => [x + dx, y + dy]) };
  if (s.type === 'rect' || s.type === 'text') return { ...s, x: (s.x ?? 0) + dx, y: (s.y ?? 0) + dy };
  if (s.type === 'ellipse') return { ...s, cx: (s.cx ?? 0) + dx, cy: (s.cy ?? 0) + dy };
  return { ...s, x1: (s.x1 ?? 0) + dx, y1: (s.y1 ?? 0) + dy, x2: (s.x2 ?? 0) + dx, y2: (s.y2 ?? 0) + dy };
}

function normalizeRect(s: Shape): Shape {
  if (s.type === 'rect') {
    const x = Math.min(s.x ?? 0, (s.x ?? 0) + (s.w ?? 0));
    const y = Math.min(s.y ?? 0, (s.y ?? 0) + (s.h ?? 0));
    return { ...s, x, y, w: Math.abs(s.w ?? 0), h: Math.abs(s.h ?? 0) };
  }
  return s;
}

function ShapeEl({ s, textScaleX = 1 }: { s: Shape; textScaleX?: number }) {
  const common = {
    stroke: s.color,
    strokeWidth: s.width,
    strokeOpacity: s.alpha ?? 1,
    fill: 'none',
    vectorEffect: 'non-scaling-stroke' as const,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  if (s.type === 'path')
    return <polyline points={(s.pts ?? []).map((p) => p.join(',')).join(' ')} {...common} />;
  if (s.type === 'rect') return <rect x={s.x} y={s.y} width={s.w} height={s.h} {...common} />;
  if (s.type === 'ellipse') return <ellipse cx={s.cx} cy={s.cy} rx={s.rx} ry={s.ry} {...common} />;
  if (s.type === 'text')
    // Contre-échelle X autour de l'ancre : glyphes non déformés malgré le viewBox étiré.
    return (
      <text
        transform={`translate(${s.x ?? 0} ${s.y ?? 0}) scale(${textScaleX} 1)`}
        fill={s.color}
        fillOpacity={s.alpha ?? 1}
        fontSize={textFontSize(s.width)}
        fontFamily="ui-sans-serif, system-ui, sans-serif"
        dominantBaseline="middle"
        style={{ userSelect: 'none' }}
      >
        {s.text}
      </text>
    );
  return <line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} {...common} markerEnd="url(#arrowhead)" />;
}
