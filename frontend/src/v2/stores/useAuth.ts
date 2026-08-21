// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { create } from 'zustand';
import { api, clearTokens, getToken, setSessionExpiredHandler, setTokens } from '../../lib/apiClient';
import { disconnectSocket } from '../../lib/socket';
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

/**
 * Ouvre une session locale : jetons enregistrés, canal temps réel remis à neuf.
 *
 * Le socket du compte précédent doit mourir avec sa session — le serveur n'authentifie
 * qu'au handshake, un socket survivant continuerait de servir notifications et messages
 * privés de l'utilisateur d'avant sur un poste partagé.
 */
function beginSession(token: string, refreshToken?: string): void {
  setTokens(token, refreshToken);
  disconnectSocket();
}

/** Ferme la session locale : jetons, canal temps réel, état applicatif. */
function endSession(): void {
  clearTokens();
  disconnectSocket();
  useAuth.setState({ user: null, ready: true });
}

export const useAuth = create<AuthState>((set) => ({
  user: null,
  ready: false,

  setAuth: (token, user) => {
    beginSession(token);
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
    beginSession(r.token!, r.refreshToken);
    set({ user: r.user! });
    return {};
  },

  verify2fa: async (tmpToken, code) => {
    const r = await api.post<{ token: string; refreshToken?: string; user: AuthUser }>(
      '/api/auth/2fa/verify',
      { tmpToken, code },
    );
    beginSession(r.token, r.refreshToken);
    set({ user: r.user });
  },

  ssoLogin: async (token, refreshToken) => {
    beginSession(token, refreshToken);
    const { user } = await api.get<{ user: AuthUser }>('/api/auth/me');
    set({ user });
  },

  logout: () => {
    // Révoque la session serveur (36.B) — best effort, avant de jeter le token local.
    void api.post('/api/auth/logout').catch(() => undefined);
    endSession();
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
      // Le client API a déjà tenté le renouvellement : arriver ici veut dire que la
      // session est bien morte.
      clearTokens();
      set({ user: null, ready: true });
    }
  },
}));

/**
 * Session morte détectée par le client API (401 non rattrapable) : l'état applicatif est
 * vidé, ce qui fait basculer `ProtectedShell` vers /login en conservant la page demandée
 * dans `location.state.from`. Pas d'appel à `/api/auth/logout` : le jeton est déjà refusé.
 */
setSessionExpiredHandler(endSession);
