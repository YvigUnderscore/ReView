// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Petit client API v2 (fetch) avec en-tête d'auth JWT.
 *
 * Les jetons sont stockés dans localStorage sous les clés `token` (accès) et
 * `refreshToken` (renouvellement) — ce module en est le seul propriétaire.
 *
 * Un 401 reçu alors qu'une session existe n'est pas une erreur métier : le jeton d'accès a
 * expiré (7 jours) ou la session a été révoquée. Le client tente alors **une** fois
 * `/api/auth/refresh` — les requêtes concurrentes attendent la même promesse — puis rejoue
 * la requête d'origine. Si le renouvellement échoue, la session est purgée et le handler
 * de session morte (branché par le store d'auth) ramène l'utilisateur à la connexion.
 */

import { t } from '../v2/i18n';

const TOKEN_KEY = 'token';
const REFRESH_KEY = 'refreshToken';

export const getToken = (): string | null => localStorage.getItem(TOKEN_KEY);

/** Enregistre les jetons de session (connexion, 2FA, SSO, renouvellement). */
export function setTokens(token: string, refreshToken?: string): void {
  localStorage.setItem(TOKEN_KEY, token);
  if (refreshToken) localStorage.setItem(REFRESH_KEY, refreshToken);
}

/** Efface la session locale — sans effet de bord applicatif. */
export function clearTokens(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
}

const authHeaders = (): Record<string, string> => {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
};

/**
 * Réaction applicative à une session morte : purge du store et retour à la connexion.
 * Branchée par `v2/stores/useAuth` — passer par un handler plutôt que par un import évite
 * le cycle apiClient ↔ store.
 */
type SessionExpiredHandler = () => void;
let onSessionExpired: SessionExpiredHandler | null = null;

export function setSessionExpiredHandler(handler: SessionExpiredHandler | null): void {
  onSessionExpired = handler;
}

/**
 * Chemins dont un 401 est une réponse métier et non une session expirée. Les rejouer n'a
 * pas de sens, et déconnecter dessus bouclerait : `/api/auth/logout` répond justement 401
 * quand le jeton est déjà mort, et c'est `logout()` qui l'appelle.
 */
const NO_RETRY_PATHS = ['/api/auth/login', '/api/auth/logout', '/api/auth/refresh', '/api/auth/2fa/verify'];
const isNoRetry = (path: string): boolean => NO_RETRY_PATHS.some((p) => path.startsWith(p));

/** Issue d'une tentative de renouvellement. `unavailable` = serveur ou réseau en défaut. */
type RefreshOutcome = 'refreshed' | 'expired' | 'unavailable';

let refreshing: Promise<RefreshOutcome> | null = null;

/** Un seul renouvellement à la fois : les requêtes concurrentes partagent la promesse. */
function refreshSession(): Promise<RefreshOutcome> {
  refreshing ??= runRefresh().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

async function runRefresh(): Promise<RefreshOutcome> {
  const refreshToken = localStorage.getItem(REFRESH_KEY);
  if (refreshToken) {
    let res: Response;
    try {
      // `fetch` direct plutôt que `request()` : un 401 sur le renouvellement lui-même ne
      // doit surtout pas relancer un renouvellement.
      res = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
    } catch {
      // Réseau coupé : la session n'est pas prouvée morte, on ne déconnecte pas.
      return 'unavailable';
    }
    if (res.ok) {
      const data = (await res.json().catch(() => ({}))) as { token?: string; refreshToken?: string };
      if (data.token) {
        setTokens(data.token, data.refreshToken);
        return 'refreshed';
      }
    } else if (res.status >= 500) {
      return 'unavailable';
    }
  }
  // Plus rien à renouveler : la session est morte. Notifié une seule fois, puisque les
  // appelants concurrents partagent cette promesse.
  clearTokens();
  onSessionExpired?.();
  return 'expired';
}

const send = (method: string, path: string, body?: unknown): Promise<Response> =>
  fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

async function parse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? t('common.error.http', { status: res.status }));
  }
  // Réponses sans corps (204 No Content, DELETE…) : pas de JSON à parser.
  if (res.status === 204 || res.headers.get('content-length') === '0') {
    return undefined as T;
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const sentWith = getToken();
  let res = await send(method, path, body);
  if (res.status === 401 && sentWith !== null && !isNoRetry(path)) {
    // Un autre appel a pu renouveler le jeton pendant que la requête était en vol : il
    // suffit alors de rejouer.
    const outcome = getToken() === sentWith ? await refreshSession() : 'refreshed';
    if (outcome === 'refreshed') res = await send(method, path, body);
    else if (outcome === 'expired') throw new Error(t('common.error.sessionExpired'));
  }
  return parse<T>(res);
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
};
