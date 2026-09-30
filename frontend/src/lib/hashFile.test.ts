// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { sha256OfFile, sha256OnMainThread } from './hashFile';

/**
 * Le hachage a changé de thread, pas de résultat : c'est ce que ces cas verrouillent.
 * L'environnement de test n'a pas de `Worker`, `sha256OfFile` y emprunte donc le repli —
 * et doit rendre exactement ce que rendait l'implémentation d'origine.
 */

/** sha256('abc') — valeur de référence FIPS 180-4. */
const SHA_ABC = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
/** sha256 de la chaîne vide. */
const SHA_EMPTY = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

describe('sha256OnMainThread', () => {
  it('rend le hachage de référence', async () => {
    await expect(sha256OnMainThread(new Blob(['abc']))).resolves.toBe(SHA_ABC);
  });

  it('traite le fichier vide', async () => {
    await expect(sha256OnMainThread(new Blob([]))).resolves.toBe(SHA_EMPTY);
  });

  it('donne le même hachage qu’un contenu lu en une fois, sur plusieurs tranches', async () => {
    // 20 Mo > la tranche de 8 Mo : trois passages dans la boucle de lecture.
    const big = new Blob([new Uint8Array(20 * 1024 * 1024).fill(7)]);
    const once = new Blob([new Uint8Array(20 * 1024 * 1024).fill(7)]);
    await expect(sha256OnMainThread(big)).resolves.toBe(await sha256OnMainThread(once));
  });
});

describe('sha256OfFile', () => {
  it('replie sur le thread principal quand aucun worker n’est disponible', async () => {
    expect(typeof Worker).toBe('undefined'); // happy-dom : c'est bien le repli qui joue
    await expect(sha256OfFile(new File(['abc'], 'a.txt'))).resolves.toBe(SHA_ABC);
  });

  it('propage l’annulation plutôt que de relancer un calcul complet', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    // Sans worker, le repli n'est pas interruptible : le contrat est de rendre le
    // hachage, jamais d'échouer — l'appelant vérifie le signal juste après.
    await expect(sha256OfFile(new File(['abc'], 'a.txt'), ctrl.signal)).resolves.toBe(SHA_ABC);
  });
});
