// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useRef, useState, useCallback, useEffect } from 'react';
import ShapeEl from './annotation/ShapeEl';
import TextDraftInput from './annotation/TextDraftInput';
import {
  ellipseFromCorners,
  hitShape,
  normalizeRect,
  translateShape,
  type Shape,
  type Tool,
} from './annotation/geometry';

export type { Shape, Tool };

/**
 * 2D annotation overlay (SVG, normalized coordinates 0..1, follows the size of the media).
 * Tools: freehand drawing, rectangle, ellipse, arrow, text, eraser (click or drag),
 * move. Controlled: `shapes` + `onChange`. Read-only, it displays without interacting.
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
  /** `stepKey` identifies the current gesture: a whole drag must count as only one step
   *  of undo, not one per `pointermove`. */
  onChange?: (s: Shape[], stepKey?: string) => void;
  editable: boolean;
  tool: Tool;
  color: string;
  width: number;
  alpha?: number;
  /** Margin (fraction) of the drawable area AROUND the media (off-frame annotations). */
  margin?: number;
  /**
   * Width/height ratio of the viewer at the time of the annotation (3D with fixed focal length).
   * In read-only mode, the X axis is rescaled around the centre (sx = captureAspect/currentAspect)
   * so that the drawing overlays correctly whatever the size of the viewer
   * (the vertical focal length being fixed, the Y axis stays unchanged).
   */
  captureAspect?: number;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [draft, setDraft] = useState<Shape | null>(null);
  const [textDraft, setTextDraft] = useState<{ x: number; y: number; value: string } | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const drag = useRef<{ id: string; ox: number; oy: number; step: string } | null>(null);
  const erasing = useRef(false);
  // Starting corner of the ellipse: drawn corner to corner (like the rect), not from the centre.
  const ellipseStart = useRef<[number, number] | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const aspect = size.h > 0 ? size.w / size.h : 0;

  // Follows the real px size of the canvas: aspect correction when reading (3D), arrow head
  // and text counter-scale computed in screen space (stretched 1×1 viewBox).
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

  // Extended viewBox: 0..1 = media, negative values or >1 = off-frame.
  const vbMin = -margin;
  const vbSize = 1 + 2 * margin;

  // Aspect correction (read-only): horizontal compression/expansion around the centre.
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
    if (!editable || tool === 'ref') return;
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
      if (s) drag.current = { id: s.id, ox: p[0], oy: p[1], step: uid() };
      return;
    }
    if (tool === 'text') {
      // A click sets the anchor point; the text is typed into the floating input.
      // preventDefault: without it, the default mousedown focus steals focus from
      // the freshly mounted input → immediate blur → entry closed before typing.
      e.preventDefault();
      commitTextDraft();
      setTextDraft({ x: p[0], y: p[1], value: '' });
      return;
    }
    const base = { id: uid(), color, width, alpha };
    if (tool === 'draw') setDraft({ ...base, type: 'path', pts: [p] });
    else if (tool === 'rect') setDraft({ ...base, type: 'rect', x: p[0], y: p[1], w: 0, h: 0 });
    else if (tool === 'ellipse') {
      ellipseStart.current = p;
      setDraft({ ...base, type: 'ellipse', cx: p[0], cy: p[1], rx: 0, ry: 0 });
    } else if (tool === 'arrow') setDraft({ ...base, type: 'arrow', x1: p[0], y1: p[1], x2: p[0], y2: p[1] });
    else if (tool === 'polygon')
      // Multi-click: each click adds a vertex; double-click closes (finishPolygon).
      setDraft(
        draft?.type === 'polygon'
          ? { ...draft, pts: [...(draft.pts ?? []), p] }
          : { ...base, type: 'polygon', pts: [p] },
      );
  };

  const move = (e: React.PointerEvent) => {
    if (!editable || tool === 'ref') return;
    const p = pt(e);
    // Eraser on drag: erases everything the pointer passes over.
    if (erasing.current) {
      eraseAt(p);
      return;
    }
    if (drag.current) {
      const d = drag.current;
      const dx = p[0] - d.ox,
        dy = p[1] - d.oy;
      drag.current = { ...d, ox: p[0], oy: p[1] };
      onChange?.(
        shapes.map((s) => (s.id === d.id ? translateShape(s, dx, dy) : s)),
        d.step,
      );
      return;
    }
    if (!draft) {
      // Hover preview (move/erase): the targeted shape is highlighted.
      if (tool === 'move' || tool === 'erase') setHoverId(hitShape(shapes, p)?.id ?? null);
      return;
    }
    if (draft.type === 'path') setDraft({ ...draft, pts: [...(draft.pts ?? []), p] });
    else if (draft.type === 'rect')
      setDraft({ ...draft, w: p[0] - (draft.x ?? 0), h: p[1] - (draft.y ?? 0) });
    else if (draft.type === 'ellipse')
      setDraft({ ...draft, ...ellipseFromCorners(ellipseStart.current ?? p, p) });
    else if (draft.type === 'arrow') setDraft({ ...draft, x2: p[0], y2: p[1] });
  };

  const up = () => {
    erasing.current = false;
    ellipseStart.current = null;
    if (drag.current) {
      drag.current = null;
      return;
    }
    // The polygon ends on double-click (finishPolygon), not on release.
    if (draft && draft.type !== 'polygon') {
      onChange?.([...shapes, normalizeRect(draft)]);
      setDraft(null);
    }
  };

  /** Closes the polygon in progress (double-click): validated if it has at least 3 vertices. */
  const finishPolygon = () => {
    if (draft?.type === 'polygon' && (draft.pts?.length ?? 0) >= 3) onChange?.([...shapes, draft]);
    setDraft(null);
  };

  // Commits the text entry in progress (Enter, blur or new click). Side effect outside the
  // updater: a parent setState inside an updater is illegal (StrictMode double invocation).
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
  // `ref`: the layer of pasted references sits above and takes the gesture; letting the
  // canvas capture the pointer here was what made the reference impossible to move.
  const interactive = editable && tool !== 'ref';
  const cursor = !interactive
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
          pointerEvents: interactive ? 'auto' : 'none',
          cursor,
          touchAction: 'none',
        }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onDoubleClick={finishPolygon}
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
