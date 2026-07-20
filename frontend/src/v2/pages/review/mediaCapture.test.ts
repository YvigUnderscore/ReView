import { describe, it, expect } from 'vitest';
import { drawAnnotations } from './mediaCapture';
import type { Shape } from '../../components/AnnotationCanvas';

/** Contexte 2D minimal qui enregistre les appels de dessin. */
function mockCtx() {
  const calls: string[] = [];
  const rec =
    (name: string) =>
    (...args: unknown[]) =>
      calls.push(`${name}(${args.join(',')})`);
  return {
    calls,
    ctx: {
      save: rec('save'),
      restore: rec('restore'),
      beginPath: rec('beginPath'),
      moveTo: rec('moveTo'),
      lineTo: rec('lineTo'),
      closePath: rec('closePath'),
      stroke: rec('stroke'),
      fill: rec('fill'),
      strokeRect: rec('strokeRect'),
      ellipse: rec('ellipse'),
      fillText: rec('fillText'),
      globalAlpha: 1,
      strokeStyle: '',
      fillStyle: '',
      lineWidth: 0,
      lineCap: '',
      lineJoin: '',
      font: '',
      textBaseline: '',
    } as unknown as CanvasRenderingContext2D,
  };
}

const base = { id: 'x', color: '#fff', width: 3, alpha: 1 };

describe('drawAnnotations (42.B №93)', () => {
  it('polygone ≥3 sommets : ferme le chemin et trace', () => {
    const { ctx, calls } = mockCtx();
    const poly: Shape = {
      ...base,
      type: 'polygon',
      pts: [
        [0.1, 0.1],
        [0.3, 0.1],
        [0.2, 0.3],
      ],
    };
    drawAnnotations(ctx, [poly], 100, 100);
    expect(calls).toContain('closePath()');
    expect(calls.filter((c) => c === 'stroke()').length).toBe(1);
  });

  it('flèche : trace le fût et remplit la tête', () => {
    const { ctx, calls } = mockCtx();
    const arrow: Shape = { ...base, type: 'arrow', x1: 0.1, y1: 0.1, x2: 0.8, y2: 0.8 };
    drawAnnotations(ctx, [arrow], 200, 200);
    expect(calls.some((c) => c === 'stroke()')).toBe(true);
    expect(calls.some((c) => c === 'fill()')).toBe(true);
  });

  it('rectangle : strokeRect ; texte : fillText', () => {
    const { ctx, calls } = mockCtx();
    const shapes: Shape[] = [
      { ...base, type: 'rect', x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
      { ...base, type: 'text', x: 0.5, y: 0.5, text: 'Note' },
    ];
    drawAnnotations(ctx, shapes, 100, 100);
    expect(calls.some((c) => c.startsWith('strokeRect('))).toBe(true);
    expect(calls.some((c) => c.startsWith('fillText(Note'))).toBe(true);
  });
});
