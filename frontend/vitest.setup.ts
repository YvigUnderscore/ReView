// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Setup for the frontend unit tests.
 *
 * Spark (`@sparkjsdev/spark`) initialises a WebAssembly module via
 * `WebAssembly.instantiateStreaming(fetch(...))`. Under Node/happy-dom, happy-dom's `Response` object
 * is not accepted by Node's streaming implementation → an uncaught rejection that would fail the suite
 * (even though our pure SPZ tests pass). We switch to the non-streaming path (`instantiate` on an
 * `ArrayBuffer`), which is universally compatible. No test is weakened: this is a workaround for an
 * environment incompatibility, not an assertion change.
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
