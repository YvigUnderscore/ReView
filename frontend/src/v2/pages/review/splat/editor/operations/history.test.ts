// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi } from 'vitest';
import { createHistory } from './history';

const op = (label: string) => ({ label, undo: vi.fn(), redo: vi.fn() });

describe('createHistory', () => {
  it('undo/redo pop by calling the callbacks', () => {
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

  it('a new operation empties the future (no redo after push)', () => {
    const h = createHistory();
    const a = op('a');
    const b = op('b');
    h.push(a);
    h.undo();
    h.push(b);
    expect(h.canRedo).toBe(false);
    expect(h.redo()).toBe(false);
  });

  it('respects LIFO order over several operations', () => {
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

  it('undo/redo with no history return false', () => {
    const h = createHistory();
    expect(h.undo()).toBe(false);
    expect(h.redo()).toBe(false);
  });

  it('undoAll cancels everything in reverse order', () => {
    const h = createHistory();
    const calls: string[] = [];
    h.push({ label: 'a', undo: () => calls.push('a'), redo: () => undefined });
    h.push({ label: 'b', undo: () => calls.push('b'), redo: () => undefined });
    h.undoAll();
    expect(calls).toEqual(['b', 'a']);
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(true);
  });

  it('clear empties both stacks', () => {
    const h = createHistory();
    h.push(op('a'));
    h.undo();
    h.clear();
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
  });
});
