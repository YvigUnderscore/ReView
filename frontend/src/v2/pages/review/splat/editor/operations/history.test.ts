import { describe, it, expect, vi } from 'vitest';
import { createHistory } from './history';

const op = (label: string) => ({ label, undo: vi.fn(), redo: vi.fn() });

describe('createHistory', () => {
  it('undo/redo dépilent en appelant les callbacks', () => {
    const h = createHistory();
    const a = op('a');
    h.push(a);
    expect(h.canUndo).toBe(true);
    expect(h.canRedo).toBe(false);

    expect(h.undo()).toBe(true);
    expect(a.undo).toHaveBeenCalledOnce();
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(true);

    expect(h.redo()).toBe(true);
    expect(a.redo).toHaveBeenCalledOnce();
    expect(h.canUndo).toBe(true);
  });

  it('une nouvelle opération vide le futur (pas de redo après push)', () => {
    const h = createHistory();
    const a = op('a');
    const b = op('b');
    h.push(a);
    h.undo();
    h.push(b);
    expect(h.canRedo).toBe(false);
    expect(h.redo()).toBe(false);
  });

  it('respecte l’ordre LIFO sur plusieurs opérations', () => {
    const h = createHistory();
    const calls: string[] = [];
    const mk = (label: string) => ({
      label,
      undo: () => calls.push(`undo-${label}`),
      redo: () => calls.push(`redo-${label}`),
    });
    h.push(mk('a'));
    h.push(mk('b'));
    h.undo();
    h.undo();
    h.redo();
    expect(calls).toEqual(['undo-b', 'undo-a', 'redo-a']);
  });

  it('undo/redo sans historique renvoient false', () => {
    const h = createHistory();
    expect(h.undo()).toBe(false);
    expect(h.redo()).toBe(false);
  });

  it('undoAll annule tout dans l’ordre inverse', () => {
    const h = createHistory();
    const calls: string[] = [];
    h.push({ label: 'a', undo: () => calls.push('a'), redo: () => undefined });
    h.push({ label: 'b', undo: () => calls.push('b'), redo: () => undefined });
    h.undoAll();
    expect(calls).toEqual(['b', 'a']);
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(true);
  });

  it('clear vide les deux piles', () => {
    const h = createHistory();
    h.push(op('a'));
    h.undo();
    h.clear();
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
  });
});
