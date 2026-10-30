// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { api } from '../../lib/apiClient';
import { t } from '../i18n';

/**
 * Browser-side Web Push (42.B — №66): service worker registration, subscription
 * PushManager (server VAPID key) and synchronisation with the backend.
 */

/** Does the browser support push notifications? */
export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/** VAPID base64url key → Uint8Array (format expected by `applicationServerKey`). */
export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  return navigator.serviceWorker.register('/sw.js');
}

/** Active push subscription of this browser (or null). */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration('/sw.js');
  return (await reg?.pushManager.getSubscription()) ?? null;
}

/** Enables push notifications: permission → subscription → backend registration. */
export async function enablePush(): Promise<void> {
  if (!pushSupported()) throw new Error(t('push.unsupported'));
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error(t('push.denied'));
  const { publicKey } = await api.get<{ publicKey: string | null }>('/api/push/key');
  if (!publicKey) throw new Error(t('push.notConfigured'));
  const reg = await registration();
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });
  await api.post('/api/push/subscribe', sub.toJSON());
}

/** Disables push notifications: browser unsubscribe + backend. */
export async function disablePush(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  await api.post('/api/push/unsubscribe', { endpoint: sub.endpoint });
  await sub.unsubscribe();
}
