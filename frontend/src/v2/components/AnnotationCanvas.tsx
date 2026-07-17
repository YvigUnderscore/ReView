import { useRef, useState, useCallback, useEffect } from 'react';
import ShapeEl from './annotation/ShapeEl';
import { hitShape, normalizeRect, translateShape, type Shape, type Tool } from './annotation/geometry';

export type { Shape, Tool };

/**
 * Overlay d'annotation 2D (SVG, coordonnées normalisées 0..1 → suit la taille du média).
 * Outils : dessin libre, rectangle, ellipse, flèche, texte, gomme (clic **ou glisser**),
 * déplacement — les deux derniers prévisualisent la forme visée au survol.
 * Couleurs + épaisseur, undo/redo, effacer tout. Contrôlé : `shapes` + `onChange`.
 * En lecture seule (`editable=false`), affiche les formes fournies sans interaction.
 */
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
  const [hoverId, setHoverId] = useState<string | null>(null);
  const drag = useRef<{ id: string; ox: number; oy: number } | null>(null);
  const erasing = useRef(false);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const aspect = size.h > 0 ? size.w / size.h : 0;

  // Suit la taille px réelle du canvas : correction d'aspect en lecture (3D), tête de
  // flèche et contre-échelle du texte calculées en espace écran (viewBox 1×1 étiré).
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      if (r.height > 0) setSize({ w: r.width, h: r.height });
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

  const eraseAt = (p: [number, number]) => {
    const s = hitShape(shapes, p);
    if (s) onChange?.(shapes.filter((x) => x.id !== s.id));
  };

  const down = (e: React.PointerEvent) => {
    if (!editable) return;
    if (e.button !== 0) return; // clic milieu/droit : laisse le pan remonter au parent
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = pt(e);
    if (tool === 'erase') {
      erasing.current = true;
      eraseAt(p);
      return;
    }
    if (tool === 'move') {
      const s = hitShape(shapes, p);
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
    // Gomme au glisser : efface tout ce que le pointeur traverse.
    if (erasing.current) {
      eraseAt(p);
      return;
    }
    if (drag.current) {
      const d = drag.current;
      const dx = p[0] - d.ox,
        dy = p[1] - d.oy;
      drag.current = { ...d, ox: p[0], oy: p[1] };
      onChange?.(shapes.map((s) => (s.id === d.id ? translateShape(s, dx, dy) : s)));
      return;
    }
    if (!draft) {
      // Prévisualisation au survol (déplacement/gomme) : forme visée surlignée.
      if (tool === 'move' || tool === 'erase') setHoverId(hitShape(shapes, p)?.id ?? null);
      return;
    }
    if (draft.type === 'path') setDraft({ ...draft, pts: [...(draft.pts ?? []), p] });
    else if (draft.type === 'rect')
      setDraft({ ...draft, w: p[0] - (draft.x ?? 0), h: p[1] - (draft.y ?? 0) });
    else if (draft.type === 'ellipse')
      setDraft({ ...draft, rx: Math.abs(p[0] - (draft.cx ?? 0)), ry: Math.abs(p[1] - (draft.cy ?? 0)) });
    else if (draft.type === 'arrow') setDraft({ ...draft, x2: p[0], y2: p[1] });
  };

  const up = () => {
    erasing.current = false;
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
  const showHover = editable && !draft && (tool === 'move' || tool === 'erase');
  const cursor = !editable
    ? 'default'
    : tool === 'move'
      ? hoverId
        ? 'move'
        : 'default'
      : tool === 'erase'
        ? 'pointer'
        : 'crosshair';

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
          cursor,
          touchAction: 'none',
        }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerLeave={() => setHoverId(null)}
      >
        <g transform={groupTransform}>
          {all.map((s) => (
            <ShapeEl
              key={s.id}
              s={s}
              size={size}
              highlight={showHover && hoverId === s.id ? (tool === 'erase' ? 'erase' : 'move') : null}
            />
          ))}
        </g>
      </svg>
    </>
  );
}

const uid = () => Math.random().toString(36).slice(2, 9);

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
