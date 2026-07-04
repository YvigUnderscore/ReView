import { create } from 'zustand';
import { api, getToken } from '../../lib/apiClient';
import type { User } from '../types/api';

/** Utilisateur de session (réponse de /api/auth/*) — sous-ensemble de l'entité User. */
export type AuthUser = Pick<
  User,
  'id' | 'email' | 'name' | 'displayName' | 'initials' | 'avatarUrl' | 'status' | 'role'
> &
  Partial<Pick<User, 'firstName' | 'lastName' | 'username'>>;

interface AuthState {
  user: AuthUser | null;
  ready: boolean; // true une fois la vérification initiale du token effectuée
  setAuth: (token: string, user: AuthUser) => void;
  setUser: (user: AuthUser) => void;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  init: () => Promise<void>;
}

export const useAuth = create<AuthState>((set) => ({
  user: null,
  ready: false,

  setAuth: (token, user) => {
    localStorage.setItem('token', token);
    set({ user });
  },

  setUser: (user) => set({ user }),

  login: async (email, password) => {
    const { token, user } = await api.post<{ token: string; user: AuthUser }>('/api/auth/login', {
      email,
      password,
    });
    localStorage.setItem('token', token);
    set({ user });
  },

  logout: () => {
    localStorage.removeItem('token');
    set({ user: null });
  },

  init: async () => {
    if (!getToken()) {
      set({ ready: true });
      return;
    }
    try {
      const { user } = await api.get<{ user: AuthUser }>('/api/auth/me');
      set({ user, ready: true });
    } catch {
      localStorage.removeItem('token');
      set({ user: null, ready: true });
    }
  },
}));
