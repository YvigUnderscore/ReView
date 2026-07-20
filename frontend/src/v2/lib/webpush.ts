import { api } from '../../lib/apiClient';

/**
 * Web Push côté navigateur (42.B — №66) : enregistrement du service worker, abonnement
 * PushManager (clé VAPID du serveur) et synchronisation avec le backend.
 */

/** Le navigateur supporte-t-il les notifications push ? */
export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/** Clé VAPID base64url → Uint8Array (format attendu par `applicationServerKey`). */
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

/** Abonnement push actif de ce navigateur (ou null). */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration('/sw.js');
  return (await reg?.pushManager.getSubscription()) ?? null;
}

/** Active les notifications push : permission → abonnement → enregistrement backend. */
export async function enablePush(): Promise<void> {
  if (!pushSupported()) throw new Error('Notifications push non supportées par ce navigateur');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Permission de notification refusée');
  const { publicKey } = await api.get<{ publicKey: string | null }>('/api/push/key');
  if (!publicKey) throw new Error('Push non configuré sur le serveur');
  const reg = await registration();
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });
  await api.post('/api/push/subscribe', sub.toJSON());
}

/** Désactive les notifications push : désabonnement navigateur + backend. */
export async function disablePush(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  await api.post('/api/push/unsubscribe', { endpoint: sub.endpoint });
  await sub.unsubscribe();
}
