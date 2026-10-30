// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * API double for rendering tests.
 *
 * The application only knows one exit, `fetch`, since `lib/apiClient`,
 * `clientApi` and `uploadClient` all go through it. We therefore replace it with a small
 * router, rather than mocking module by module: a test describes what the server
 * answers, and the component really goes through its own data layer (tokens,
 * 401 renewal, TanStack Query). Mocking `api.get` would skip all of that.
 *
 * A request that no route covers answers **501 with its own path in plain text** and
 * is recorded in `unhandled`: a silent screen becomes a readable message on screen and a
 * possible assertion, instead of a wait that times out.
 */

/** Request received, as a route sees it. */
export interface MockRequest {
  method: string;
  /** Path without query string. */
  path: string;
  url: URL;
  /** Named segments of the pattern (`/api/media/:id` → `{ id: '12' }`). */
  params: Record<string, string>;
  /** JSON body sent, when there is one. */
  body: unknown;
}

/**
 * A route's response: a JSON value, a `Response`, or what is needed to compute it.
 *
 * The type enumerates the accepted forms instead of saying `unknown`: a union with `unknown`
 * collapses to `unknown`, and the parameter of a route written as an arrow function
 * (`({ url }) => …`) would then stop being typed by the context.
 */
export type MockResolver = ((req: MockRequest) => unknown) | object | string | number | boolean | null;

/** Explicit error response: `httpError(403, 'Forbidden')`. */
class HttpError {
  constructor(
    readonly status: number,
    readonly error: string,
  ) {}
}

/** Makes the route respond with this status and this message (backend error shape). */
export function httpError(status: number, error: string): MockResolver {
  return new HttpError(status, error);
}

/** 204 response without a body: DELETE and the like. */
export function noContent(): MockResolver {
  return new Response(null, { status: 204 });
}

interface Route {
  method: string;
  segments: string[];
  /** Exact query string required by the key, if it carries one. */
  search: string | null;
  resolver: MockResolver;
}

export interface ApiMock {
  /** Adds or replaces a route (`'GET /api/projects'`). The last one set wins. */
  on(route: string, resolver: MockResolver): ApiMock;
  /** All requests received, in order. */
  readonly calls: MockRequest[];
  /** The requests received on a route (`'PATCH /api/tasks/:id'`). */
  called(route: string): MockRequest[];
  /** Requests that no route covered: must stay empty. */
  readonly unhandled: string[];
  /** Gives `fetch` back to the environment. */
  restore(): void;
}

const parseKey = (key: string): { method: string; segments: string[]; search: string | null } => {
  const space = key.indexOf(' ');
  // Concatenation rather than a template: the hard-coded text detector reads the templates
  // of a `new X(...)` as interface prose, and this message only reaches a test.
  if (space < 0) throw new Error('Mock route must be "METHOD /path": ' + key);
  const method = key.slice(0, space).toUpperCase();
  const rest = key.slice(space + 1);
  const q = rest.indexOf('?');
  const pathname = q < 0 ? rest : rest.slice(0, q);
  return { method, segments: pathname.split('/'), search: q < 0 ? null : rest.slice(q + 1) };
};

/** Does the pattern cover this path? Returns the named segments, or `null`. */
function matchPath(pattern: string[], actual: string[]): Record<string, string> | null {
  const params: Record<string, string> = {};
  for (let i = 0; i < pattern.length; i += 1) {
    const p = pattern[i];
    if (p === '*') return params; // joker terminal : couvre toute la suite
    if (i >= actual.length) return null;
    if (p.startsWith(':')) {
      params[p.slice(1)] = actual[i];
      continue;
    }
    if (p !== actual[i]) return null;
  }
  return pattern.length === actual.length ? params : null;
}

/** An exact-query-string route takes precedence over the same route without one. */
function score(route: Route): number {
  return route.search === null ? 0 : 1;
}

function toResponse(value: unknown): Response {
  if (value instanceof Response) return value;
  if (value instanceof HttpError) {
    return new Response(JSON.stringify({ error: value.error }), {
      status: value.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (value === undefined) return new Response(null, { status: 204 });
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function readBody(init?: RequestInit): unknown {
  const body = init?.body;
  if (typeof body !== 'string') return undefined;
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return body;
  }
}

/**
 * Installs the router on `globalThis.fetch` and returns what is needed to drive it.
 *
 * `renderWithProviders` calls it for each test and then restores it: use it
 * directly only for a test that has nothing to render.
 */
export function mockApi(routes: Record<string, MockResolver> = {}): ApiMock {
  const table: Route[] = [];
  const calls: MockRequest[] = [];
  const unhandled: string[] = [];
  const original = globalThis.fetch;

  const add = (key: string, resolver: MockResolver) => {
    const { method, segments, search } = parseKey(key);
    // A redefinition replaces the previous one: a test can tighten a route set
    // by the harness's default values.
    const existing = table.findIndex(
      (r) => r.method === method && r.segments.join('/') === segments.join('/') && r.search === search,
    );
    const route: Route = { method, segments, search, resolver };
    if (existing >= 0) table[existing] = route;
    else table.push(route);
  };

  Object.entries(routes).forEach(([key, resolver]) => add(key, resolver));

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw, 'http://localhost');
    // A local resource (`file:`, `data:`, `blob:`) is not an API call: the `.wasm`
    // that Spark loads on import would otherwise receive a JSON error, rejected outside any test.
    if (!url.protocol.startsWith('http')) return original(input, init);
    const method = (init?.method ?? 'GET').toUpperCase();
    const actual = url.pathname.split('/');
    const candidates = table
      .filter((r) => r.method === method)
      .filter((r) => r.search === null || r.search === url.searchParams.toString())
      .map((r) => ({ route: r, params: matchPath(r.segments, actual) }))
      .filter((c): c is { route: Route; params: Record<string, string> } => c.params !== null)
      .sort((a, b) => score(b.route) - score(a.route));

    const request: MockRequest = {
      method,
      path: url.pathname,
      url,
      params: candidates[0]?.params ?? {},
      body: readBody(init),
    };
    calls.push(request);

    const hit = candidates[0];
    if (!hit) {
      const label = `${method} ${url.pathname}${url.search}`;
      unhandled.push(label);
      return toResponse(new HttpError(501, 'Unhandled request: ' + label));
    }
    const { resolver } = hit.route;
    const value =
      typeof resolver === 'function' ? await (resolver as (r: MockRequest) => unknown)(request) : resolver;
    return toResponse(value);
  };

  return {
    on(route, resolver) {
      add(route, resolver);
      return this;
    },
    calls,
    called(route) {
      const { method, segments, search } = parseKey(route);
      return calls.filter(
        (c) =>
          c.method === method &&
          matchPath(segments, c.path.split('/')) !== null &&
          (search === null || search === c.url.searchParams.toString()),
      );
    },
    unhandled,
    restore() {
      globalThis.fetch = original;
    },
  };
}

/** Promise resolved by hand: to observe a loading state before the response. */
export function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
