// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { t } from '../v2/i18n';

/**
 * Primitives de transfert du moteur de téléversement (vague 2).
 *
 * Trois manques structurels de l'envoi d'origine sont traités ici, à l'écart du flux
 * métier de `uploadClient` :
 *  - **annulation réelle** : un `AbortSignal` interrompt la requête en vol (`xhr.abort`),
 *    là où « retirer la ligne » laissait le transfert consommer la bande passante ;
 *  - **réessai par part** : une coupure sur une part faisait échouer 20 Go d'envoi ; on
 *    réessaie trois fois avec attente progressive, et on re-signe l'URL quand le refus
 *    ressemble à une signature périmée (les présignatures vivent une heure) ;
 *  - **parallélisme borné** : S3 accepte plusieurs parts de front, une boucle `for` n'en
 *    utilisait qu'une seule connexion.
 */

/** Annulation demandée par l'utilisateur : ni un échec réseau, ni à réessayer. */
class UploadAbortError extends Error {
  constructor() {
    super('aborted');
    this.name = 'UploadAbortError';
  }
}

/** Refus HTTP du stockage — le statut décide du réessai et de la re-signature. */
export class UploadHttpError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(t('uploads.error.storage', { status }));
    this.name = 'UploadHttpError';
    this.status = status;
  }
}

export const isAbortError = (err: unknown): boolean => err instanceof UploadAbortError;

/** Un 4xx définitif ne se réessaie pas ; tout le reste (réseau, 5xx, 408, 429) si. */
function isRetriable(err: unknown): boolean {
  if (isAbortError(err)) return false;
  if (err instanceof UploadHttpError && err.status >= 400 && err.status < 500) {
    return err.status === 401 || err.status === 403 || err.status === 408 || err.status === 429;
  }
  return true;
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new UploadAbortError();
}

/** Attente interruptible — un abandon ne doit pas patienter jusqu'au bout du backoff. */
function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    // Signal déjà déclenché : `addEventListener('abort')` ne se rejouerait pas, et le
    // backoff s'écoulerait en entier après une annulation.
    if (signal?.aborted) return reject(new UploadAbortError());
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort(): void {
      clearTimeout(timer);
      reject(new UploadAbortError());
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** PUT XHR avec progression et annulation ; renvoie l'ETag (multipart) — null si absent. */
export function putWithProgress(
  url: string,
  body: Blob,
  contentType: string | null,
  onProgress: (loaded: number) => void,
  signal?: AbortSignal,
): Promise<string | null> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new UploadAbortError());
    const xhr = new XMLHttpRequest();
    const onAbort = (): void => xhr.abort();
    const settle = (fn: () => void): void => {
      signal?.removeEventListener('abort', onAbort);
      fn();
    };
    xhr.open('PUT', url);
    if (contentType) xhr.setRequestHeader('Content-Type', contentType);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded);
    };
    xhr.onload = () =>
      settle(() =>
        xhr.status >= 200 && xhr.status < 300
          ? resolve(xhr.getResponseHeader('ETag'))
          : reject(new UploadHttpError(xhr.status)),
      );
    xhr.onerror = () => settle(() => reject(new Error(t('uploads.error.network'))));
    xhr.onabort = () => settle(() => reject(new UploadAbortError()));
    signal?.addEventListener('abort', onAbort, { once: true });
    xhr.send(body);
  });
}

/** Attentes entre deux tentatives : trois réessais, de plus en plus espacés. */
export const RETRY_DELAYS = [500, 1500, 4000];

/**
 * Rejoue `attempt` jusqu'à épuisement des attentes. Le numéro de tentative est passé à
 * l'appelant pour qu'il puisse, par exemple, redemander une URL présignée.
 */
export async function withRetry<T>(
  attempt: (tryIndex: number) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  let last: unknown;
  for (let i = 0; i <= RETRY_DELAYS.length; i++) {
    throwIfAborted(signal);
    try {
      return await attempt(i);
    } catch (err) {
      if (!isRetriable(err) || i === RETRY_DELAYS.length) throw err;
      last = err;
      await wait(RETRY_DELAYS[i], signal);
    }
  }
  throw last; // inatteignable : la dernière tentative relance son propre échec
}

/**
 * Exécute `task` sur chaque élément avec au plus `limit` tâches simultanées, et s'arrête
 * à la première erreur (les tâches déjà lancées vont à leur terme, aucune n'est orpheline).
 */
export async function runPool<T>(items: T[], limit: number, task: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  let failed = false;
  let failure: unknown;
  const lane = async (): Promise<void> => {
    while (!failed) {
      const index = cursor++;
      if (index >= items.length) return;
      try {
        await task(items[index]);
      } catch (err) {
        failed = true;
        failure = err;
        return;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  if (failed) throw failure;
}
