// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Mini-client HTTP de la page client publique (35.D) : pas de JWT utilisateur, mais une
 * session de partage (`X-Share-Auth`, émise par le GET initial ou l'unlock) conservée en
 * sessionStorage par token.
 */

import { t } from '../../i18n';

const authKey = (token: string) => `share-auth:${token}`;

export const getShareAuth = (token: string): string | null => sessionStorage.getItem(authKey(token));
export const setShareAuth = (token: string, auth: string): void =>
  sessionStorage.setItem(authKey(token), auth);

export class ClientApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(token: string, method: string, path: string, body?: unknown): Promise<T> {
  const auth = getShareAuth(token);
  const res = await fetch(`/api/client/${token}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(auth ? { 'X-Share-Auth': auth } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ClientApiError(data.error ?? t('common.error.http', { status: res.status }), res.status);
  }
  return (await res.json()) as T;
}

export const clientApi = {
  get: <T>(token: string, path = '') => request<T>(token, 'GET', path),
  post: <T>(token: string, path: string, body?: unknown) => request<T>(token, 'POST', path, body),
};
