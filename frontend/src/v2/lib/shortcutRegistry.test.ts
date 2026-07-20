import { describe, it, expect } from 'vitest';
import { isValidKey, resolveBindings, GLOBAL_SHORTCUTS } from './shortcutRegistry';

describe('shortcutRegistry (42.A2)', () => {
  it('isValidKey : un seul caractère, jamais le leader « g »', () => {
    expect(isValidKey('p')).toBe(true);
    expect(isValidKey('?')).toBe(true);
    expect(isValidKey('g')).toBe(false);
    expect(isValidKey('G')).toBe(false);
    expect(isValidKey('')).toBe(false);
    expect(isValidKey('ab')).toBe(false);
  });

  it('resolveBindings : défauts sans surcharge', () => {
    const b = resolveBindings(undefined);
    expect(b['nav.projects']).toBe('p');
    expect(b['nav.kanban']).toBe('k');
    expect(b['nav.board']).toBe('b');
    expect(b.help).toBe('?');
  });

  it('applique une surcharge valide', () => {
    const b = resolveBindings({ 'nav.projects': 'a' });
    expect(b['nav.projects']).toBe('a');
    // Les autres restent aux défauts.
    expect(b['nav.kanban']).toBe('k');
  });

  it('ignore les surcharges invalides (vide, multi-caractères, « g »)', () => {
    const b = resolveBindings({ 'nav.projects': '', 'nav.kanban': 'zz', 'nav.board': 'g' });
    expect(b['nav.projects']).toBe('p');
    expect(b['nav.kanban']).toBe('k');
    expect(b['nav.board']).toBe('b');
  });

  it('chaque défaut est une touche valide et unique par type', () => {
    const leader = GLOBAL_SHORTCUTS.filter((s) => s.kind === 'leader-g').map((s) => s.defaultKey);
    expect(new Set(leader).size).toBe(leader.length);
    for (const s of GLOBAL_SHORTCUTS) expect(isValidKey(s.defaultKey)).toBe(true);
  });
});
