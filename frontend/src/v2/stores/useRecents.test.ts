import { describe, it, expect, beforeEach } from 'vitest';
import { useRecents, trackRecent, type RecentEntry } from './useRecents';

const entry = (n: number): Omit<RecentEntry, 'at'> => ({
  key: `shot:${n}`, type: 'shot', label: `SH0${n}0`, to: `/projects/1?tab=shots&shot=${n}`,
});

beforeEach(() => {
  localStorage.clear();
  useRecents.setState({ recents: [] });
});

describe('useRecents', () => {
  it('push : ajoute en tête et persiste en localStorage', () => {
    trackRecent(entry(1));
    trackRecent(entry(2));
    const recents = useRecents.getState().recents;
    expect(recents.map((r) => r.key)).toEqual(['shot:2', 'shot:1']);
    const stored = JSON.parse(localStorage.getItem('review:recents')!) as RecentEntry[];
    expect(stored).toHaveLength(2);
  });

  it('dédoublonne par clé : une re-visite remonte en tête', () => {
    trackRecent(entry(1));
    trackRecent(entry(2));
    trackRecent(entry(1));
    expect(useRecents.getState().recents.map((r) => r.key)).toEqual(['shot:1', 'shot:2']);
  });

  it('borne l’historique à 5 entrées', () => {
    for (let i = 1; i <= 7; i++) trackRecent(entry(i));
    const keys = useRecents.getState().recents.map((r) => r.key);
    expect(keys).toHaveLength(5);
    expect(keys[0]).toBe('shot:7');
    expect(keys).not.toContain('shot:1');
    expect(keys).not.toContain('shot:2');
  });

  it('tolère un localStorage corrompu à la lecture initiale', () => {
    localStorage.setItem('review:recents', '{pas du json[');
    // read() est appelé à l'init du store : on le rejoue via une nouvelle lecture
    trackRecent(entry(1)); // ne doit pas jeter
    expect(useRecents.getState().recents).toHaveLength(1);
  });
});
