// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createSHA256 } from 'hash-wasm';

/**
 * Worker de hachage sha256 (vague 2 — moteur de téléversement).
 *
 * Le checksum bout-en-bout (37.B) portait sur le thread principal : un master de 20 Go
 * gelait l'interface plusieurs dizaines de secondes **avant** que le premier octet ne
 * parte. Le calcul vit désormais ici ; le `Blob` traverse la frontière du worker par
 * référence (aucune copie des octets), seul le résultat hexadécimal revient.
 *
 * Le protocole est volontairement minimal : une requête porte un identifiant, la
 * réponse le renvoie — un worker unique sert donc plusieurs fichiers en parallèle.
 */

/** Requête de hachage : un blob à lire, un identifiant à renvoyer tel quel. */
export interface Sha256Request {
  id: number;
  blob: Blob;
}

/** Réponse : le hachage hexadécimal, ou le motif de l'échec. */
export type Sha256Response = { id: number; hash: string } | { id: number; error: string };

/** Taille de tranche de lecture — compromis mémoire / nombre d'allers-retours. */
const CHUNK = 8 * 1024 * 1024;

/**
 * Contexte du worker. `lib` ne contient pas `WebWorker` (tsconfig ciblant le DOM) : on
 * décrit ici la surface réellement utilisée plutôt que d'élargir la configuration.
 */
const ctx = self as unknown as {
  addEventListener(type: 'message', fn: (event: MessageEvent<Sha256Request>) => void): void;
  postMessage(message: Sha256Response): void;
};

async function hash(blob: Blob): Promise<string> {
  const hasher = await createSHA256();
  for (let off = 0; off < blob.size; off += CHUNK) {
    const buf = await blob.slice(off, off + CHUNK).arrayBuffer();
    hasher.update(new Uint8Array(buf));
  }
  return hasher.digest('hex');
}

ctx.addEventListener('message', (event) => {
  const { id, blob } = event.data;
  void hash(blob).then(
    (value) => ctx.postMessage({ id, hash: value }),
    (err: unknown) => ctx.postMessage({ id, error: err instanceof Error ? err.message : String(err) }),
  );
});
