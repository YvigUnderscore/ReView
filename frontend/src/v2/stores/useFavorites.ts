import { create } from 'zustand';
import { api } from '../../lib/apiClient';

export type FavType = 'PROJECT' | 'SEQUENCE' | 'SHOT' | 'ASSET';
export interface Favorite {
  id: number; type: FavType; entityId: number;
  label: string; projectId: number; to: string;
}

interface FavState {
  favorites: Favorite[];
  loaded: boolean;
  load: () => Promise<void>;
  isFav: (type: FavType, entityId: number) => boolean;
  toggle: (type: FavType, entityId: number) => Promise<void>;
}

const key = (t: FavType, id: number) => `${t}:${id}`;

export const useFavorites = create<FavState>((set, get) => ({
  favorites: [],
  loaded: false,

  load: async () => {
    try {
      const { favorites } = await api.get<{ favorites: Favorite[] }>('/api/favorites');
      set({ favorites, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },

  isFav: (type, entityId) => get().favorites.some((f) => key(f.type, f.entityId) === key(type, entityId)),

  toggle: async (type, entityId) => {
    const exists = get().isFav(type, entityId);
    if (exists) {
      // Retrait optimiste
      set({ favorites: get().favorites.filter((f) => key(f.type, f.entityId) !== key(type, entityId)) });
      try { await api.del(`/api/favorites/${type}/${entityId}`); } catch { await get().load(); }
    } else {
      try {
        await api.post('/api/favorites', { type, entityId });
        await get().load();
      } catch { /* ignore */ }
    }
  },
}));
