import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useFavorites, type Favorite } from './useFavorites';
import { api } from '../../lib/apiClient';

vi.mock('../../lib/apiClient', () => ({
  api: { get: vi.fn(), post: vi.fn(), del: vi.fn() },
}));
const apiMock = vi.mocked(api);

const fav: Favorite = {
  id: 1,
  type: 'SHOT',
  entityId: 5,
  label: 'SH010',
  projectId: 1,
  to: '/projects/1?tab=shots&shot=5',
};

beforeEach(() => {
  vi.mocked(apiMock.get).mockReset();
  vi.mocked(apiMock.post).mockReset();
  vi.mocked(apiMock.del).mockReset();
  useFavorites.setState({ favorites: [], loaded: false });
});

describe('useFavorites', () => {
  it('load : hydrate la liste et marque loaded', async () => {
    vi.mocked(apiMock.get).mockResolvedValue({ favorites: [fav] });
    await useFavorites.getState().load();
    expect(useFavorites.getState().favorites).toHaveLength(1);
    expect(useFavorites.getState().loaded).toBe(true);
    expect(useFavorites.getState().isFav('SHOT', 5)).toBe(true);
    expect(useFavorites.getState().isFav('SHOT', 6)).toBe(false);
  });

  it('load en échec : loaded quand même (pas de crash)', async () => {
    vi.mocked(apiMock.get).mockRejectedValue(new Error('réseau'));
    await useFavorites.getState().load();
    expect(useFavorites.getState().loaded).toBe(true);
  });

  it('toggle retrait : optimiste (retiré avant la réponse serveur)', async () => {
    useFavorites.setState({ favorites: [fav], loaded: true });
    let resolveDel!: () => void;
    vi.mocked(apiMock.del).mockReturnValue(
      new Promise<unknown>((r) => {
        resolveDel = () => r(undefined);
      }),
    );
    const p = useFavorites.getState().toggle('SHOT', 5);
    expect(useFavorites.getState().isFav('SHOT', 5)).toBe(false); // déjà retiré
    resolveDel();
    await p;
    expect(vi.mocked(apiMock.del)).toHaveBeenCalledWith('/api/favorites/SHOT/5');
  });

  it('toggle retrait en échec : rollback par rechargement', async () => {
    useFavorites.setState({ favorites: [fav], loaded: true });
    vi.mocked(apiMock.del).mockRejectedValue(new Error('500'));
    vi.mocked(apiMock.get).mockResolvedValue({ favorites: [fav] });
    await useFavorites.getState().toggle('SHOT', 5);
    expect(useFavorites.getState().isFav('SHOT', 5)).toBe(true); // restauré
  });

  it('toggle ajout : POST puis rechargement', async () => {
    vi.mocked(apiMock.post).mockResolvedValue({});
    vi.mocked(apiMock.get).mockResolvedValue({ favorites: [fav] });
    await useFavorites.getState().toggle('SHOT', 5);
    expect(vi.mocked(apiMock.post)).toHaveBeenCalledWith('/api/favorites', { type: 'SHOT', entityId: 5 });
    expect(useFavorites.getState().isFav('SHOT', 5)).toBe(true);
  });
});
