// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Setup des tests unitaires frontend.
 *
 * Spark (`@sparkjsdev/spark`) initialise un module WebAssembly via
 * `WebAssembly.instantiateStreaming(fetch(...))`. Sous Node/happy-dom, l'objet `Response` de
 * happy-dom n'est pas accepté par l'implémentation streaming de Node → rejet non capturé qui
 * ferait échouer la suite (bien que nos tests SPZ, purs, réussissent). On bascule sur le chemin
 * non-streaming (`instantiate` sur un `ArrayBuffer`), universellement compatible. Aucun test
 * n'est affaibli : c'est un contournement d'incompatibilité d'environnement, pas d'assertion.
 */
const streaming = WebAssembly.instantiateStreaming;
if (typeof streaming === 'function') {
  WebAssembly.instantiateStreaming = async (
    source: Response | PromiseLike<Response>,
    imports?: WebAssembly.Imports,
  ) => {
    const response = await source;
    const bytes = await response.arrayBuffer();
    return WebAssembly.instantiate(bytes, imports);
  };
}
