// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { create } from 'zustand';
import { api, clearTokens, getToken, setSessionExpiredHandler, setTokens } from '../../lib/apiClient';
import { disconnectSocket } from '../../lib/socket';
import type { User } from '../types/api';

/** Session user (response of /api/auth/*) — subset of the User entity. */
export type AuthUser = Pick<
  User,
  'id' | 'email' | 'name' | 'displayName' | 'initials' | 'avatarUrl' | 'status' | 'role'
> &
  Partial<Pick<User, 'firstName' | 'lastName' | 'username' | 'jobTitle' | 'bio' | 'phone'>> & {
    /** 2FA TOTP enabled on the account (returned by /api/auth/me, 36.A). */
    twoFaEnabled?: boolean;
  };

interface AuthState {
  user: AuthUser | null;
  ready: boolean; // true once the initial token check has been performed
  setAuth: (token: string, user: AuthUser) => void;
  setUser: (user: AuthUser) => void;
  /** Returns `{ tmpToken }` if the account requires a 2FA code (36.A) — otherwise signs in. */
  login: (email: string, password: string) => Promise<{ tmpToken?: string }>;
  /** Exchanges the intermediate token + TOTP/backup code for the session (36.A). */
  verify2fa: (tmpToken: string, code: string) => Promise<void>;
  /** Sign-in from an SSO return (#sso= fragment, 36.A). */
  ssoLogin: (token: string, refreshToken?: string) => Promise<void>;
  logout: () => void;
  init: () => Promise<void>;
}

/**
 * Opens a local session: tokens stored, real-time channel renewed.
 *
 * The previous account's socket must die with its session — the server only authenticates at the
 * handshake, so a surviving socket would keep serving the previous user's notifications and private
 * messages on a shared workstation.
 */
function beginSession(token: string, refreshToken?: string): void {
  setTokens(token, refreshToken);
  disconnectSocket();
}

/** Closes the local session: tokens, real-time channel, application state. */
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
    // Revokes the server session (36.B) — best effort, before discarding the local token.
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
      // The API client has already tried to renew: reaching this point means the session
      // is indeed dead.
      clearTokens();
      set({ user: null, ready: true });
    }
  },
}));

/**
 * Dead session detected by the API client (unrecoverable 401): the application state is cleared,
 * which switches `ProtectedShell` to /login while keeping the requested page in
 * `location.state.from`. No call to `/api/auth/logout`: the token is already refused.
 */
setSessionExpiredHandler(endSession);
