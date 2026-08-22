// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createSHA256 } from 'hash-wasm';
import type { Sha256Request, Sha256Response } from './sha256.worker';

/**
 * sha256 d'un fichier, hors du thread principal quand c'est possible.
 *
 * Le hachage sert au checksum bout-en-bout et à la déduplication (37.B) : il doit être
 * calculé avant l'envoi, mais rien n'oblige à le calculer *sur le thread qui dessine*.
 * Un worker unique, créé à la première demande et réutilisé, porte le calcul ; s'il est
 * indisponible (environnement de test, worker refusé, module illisible), le repli
 * historique sur le thread principal reprend la main — le téléversement n'échoue jamais
 * faute de worker.
 */

/** Taille de tranche de lecture, identique côté worker et côté repli. */
const HASH_CHUNK = 8 * 1024 * 1024;

/** sha256 hex calculé sur le thread appelant — repli, et implémentation de référence. */
export async function sha256OnMainThread(blob: Blob): Promise<string> {
  const hasher = await createSHA256();
  for (let off = 0; off < blob.size; off += HASH_CHUNK) {
    const buf = await blob.slice(off, off + HASH_CHUNK).arrayBuffer();
    hasher.update(new Uint8Array(buf));
  }
  return hasher.digest('hex');
}

/** `undefined` = pas encore tenté, `null` = définitivement indisponible. */
let worker: Worker | null | undefined;
let nextId = 0;
const pending = new Map<number, { resolve: (hash: string) => void; reject: (err: Error) => void }>();

/** Abandonne le worker et fait échouer les demandes en cours : l'appelant repliera. */
function giveUpWorker(reason: string): void {
  worker?.terminate();
  worker = null;
  for (const [, waiter] of pending) waiter.reject(new Error(reason));
  pending.clear();
}

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  // happy-dom (tests) et les contextes sans worker : on ne tente même pas.
  if (typeof Worker === 'undefined') {
    worker = null;
    return null;
  }
  try {
    const created = new Worker(new URL('./sha256.worker.ts', import.meta.url), { type: 'module' });
    created.addEventListener('message', (event: MessageEvent<Sha256Response>) => {
      const waiter = pending.get(event.data.id);
      if (!waiter) return; // demande abandonnée entre-temps (upload annulé)
      pending.delete(event.data.id);
      if ('hash' in event.data) waiter.resolve(event.data.hash);
      else waiter.reject(new Error(event.data.error));
    });
    created.addEventListener('error', () => giveUpWorker('sha256 worker error'));
    worker = created;
  } catch {
    worker = null;
  }
  return worker;
}

function hashInWorker(w: Worker, blob: Blob, signal?: AbortSignal): Promise<string> {
  const id = nextId++;
  return new Promise<string>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    // Annulation : on cesse d'attendre. Le worker terminera son calcul dans le vide,
    // sa réponse ne trouvera plus de demandeur — moins coûteux que de le recréer.
    signal?.addEventListener(
      'abort',
      () => {
        pending.delete(id);
        reject(new Error('aborted'));
      },
      { once: true },
    );
    const message: Sha256Request = { id, blob };
    w.postMessage(message);
  });
}

/**
 * sha256 hex du fichier. Utilise le worker si possible, sinon le thread principal.
 * `signal` interrompt l'attente (le repli, lui, s'arrête à la tranche suivante).
 */
export async function sha256OfFile(file: Blob, signal?: AbortSignal): Promise<string> {
  const w = getWorker();
  if (w) {
    try {
      return await hashInWorker(w, file, signal);
    } catch (err) {
      // Annulation demandée : ne pas relancer un calcul complet sur le thread principal.
      if (signal?.aborted) throw err;
    }
  }
  return sha256OnMainThread(file);
}
