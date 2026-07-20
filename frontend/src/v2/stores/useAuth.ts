import { create } from 'zustand';
import { api, getToken } from '../../lib/apiClient';
import type { User } from '../types/api';

/** Utilisateur de session (réponse de /api/auth/*) — sous-ensemble de l'entité User. */
export type AuthUser = Pick<
  User,
  'id' | 'email' | 'name' | 'displayName' | 'initials' | 'avatarUrl' | 'status' | 'role'
> &
  Partial<Pick<User, 'firstName' | 'lastName' | 'username' | 'jobTitle' | 'bio' | 'phone'>> & {
    /** 2FA TOTP active sur le compte (renvoyé par /api/auth/me, 36.A). */
    twoFaEnabled?: boolean;
  };

interface AuthState {
  user: AuthUser | null;
  ready: boolean; // true une fois la vérification initiale du token effectuée
  setAuth: (token: string, user: AuthUser) => void;
  setUser: (user: AuthUser) => void;
  /** Renvoie `{ tmpToken }` si le compte exige un code 2FA (36.A) — sinon connecte. */
  login: (email: string, password: string) => Promise<{ tmpToken?: string }>;
  /** Échange le jeton intermédiaire + code TOTP/secours contre la session (36.A). */
  verify2fa: (tmpToken: string, code: string) => Promise<void>;
  /** Connexion depuis un retour SSO (fragment #sso=, 36.A). */
  ssoLogin: (token: string, refreshToken?: string) => Promise<void>;
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
    const r = await api.post<{
      token?: string;
      refreshToken?: string;
      user?: AuthUser;
      requires2fa?: boolean;
      tmpToken?: string;
    }>('/api/auth/login', { email, password });
    if (r.requires2fa && r.tmpToken) return { tmpToken: r.tmpToken };
    localStorage.setItem('token', r.token!);
    if (r.refreshToken) localStorage.setItem('refreshToken', r.refreshToken);
    set({ user: r.user! });
    return {};
  },

  verify2fa: async (tmpToken, code) => {
    const r = await api.post<{ token: string; refreshToken?: string; user: AuthUser }>(
      '/api/auth/2fa/verify',
      { tmpToken, code },
    );
    localStorage.setItem('token', r.token);
    if (r.refreshToken) localStorage.setItem('refreshToken', r.refreshToken);
    set({ user: r.user });
  },

  ssoLogin: async (token, refreshToken) => {
    localStorage.setItem('token', token);
    if (refreshToken) localStorage.setItem('refreshToken', refreshToken);
    const { user } = await api.get<{ user: AuthUser }>('/api/auth/me');
    set({ user });
  },

  logout: () => {
    // Révoque la session serveur (36.B) — best effort, avant de jeter le token local.
    void api.post('/api/auth/logout').catch(() => undefined);
    localStorage.removeItem('token');
    localStorage.removeItem('refreshToken');
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
