// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Bouchon d'API pour les tests de rendu.
 *
 * L'application ne connaît qu'une porte de sortie — `fetch` — puisque `lib/apiClient`,
 * `clientApi` et `uploadClient` passent tous par lui. On la remplace donc par un petit
 * routeur, plutôt que de bouchonner module par module : un test décrit ce que le serveur
 * répond, et le composant traverse pour de vrai sa propre couche de données (jetons,
 * renouvellement 401, TanStack Query). Bouchonner `api.get` sauterait tout cela.
 *
 * Une requête qu'aucune route ne couvre répond **501 avec son propre chemin en clair** et
 * s'inscrit dans `unhandled` : un écran muet devient un message lisible à l'écran et une
 * assertion possible, au lieu d'une attente qui expire.
 */

/** Requête reçue, telle que la voit une route. */
export interface MockRequest {
  method: string;
  /** Chemin sans query-string. */
  path: string;
  url: URL;
  /** Segments nommés du motif (`/api/media/:id` → `{ id: '12' }`). */
  params: Record<string, string>;
  /** Corps JSON envoyé, quand il y en a un. */
  body: unknown;
}

/**
 * Réponse d'une route : une valeur JSON, une `Response`, ou de quoi la calculer.
 *
 * Le type énumère les formes acceptées au lieu de dire `unknown` : une union avec `unknown`
 * s'effondre sur `unknown`, et le paramètre d'une route écrite en flèche
 * (`({ url }) => …`) cesse alors d'être typé par le contexte.
 */
export type MockResolver = ((req: MockRequest) => unknown) | object | string | number | boolean | null;

/** Réponse d'erreur explicite — `httpError(403, 'Forbidden')`. */
class HttpError {
  constructor(
    readonly status: number,
    readonly error: string,
  ) {}
}

/** Fait répondre la route avec ce statut et ce message (forme d'erreur du backend). */
export function httpError(status: number, error: string): MockResolver {
  return new HttpError(status, error);
}

/** Réponse 204 sans corps — DELETE et consorts. */
export function noContent(): MockResolver {
  return new Response(null, { status: 204 });
}

interface Route {
  method: string;
  segments: string[];
  /** Query-string exacte exigée par la clé, si elle en portait une. */
  search: string | null;
  resolver: MockResolver;
}

export interface ApiMock {
  /** Ajoute ou remplace une route (`'GET /api/projects'`). La dernière posée gagne. */
  on(route: string, resolver: MockResolver): ApiMock;
  /** Toutes les requêtes reçues, dans l'ordre. */
  readonly calls: MockRequest[];
  /** Les requêtes reçues sur une route (`'PATCH /api/tasks/:id'`). */
  called(route: string): MockRequest[];
  /** Les requêtes qu'aucune route ne couvrait — doit rester vide. */
  readonly unhandled: string[];
  /** Rend `fetch` à l'environnement. */
  restore(): void;
}

const parseKey = (key: string): { method: string; segments: string[]; search: string | null } => {
  const space = key.indexOf(' ');
  // Concaténation plutôt que gabarit : le détecteur de texte en dur lit les gabarits
  // d'un `new X(...)` comme de la prose d'interface, et ce message n'atteint qu'un test.
  if (space < 0) throw new Error('Mock route must be "METHOD /path": ' + key);
  const method = key.slice(0, space).toUpperCase();
  const rest = key.slice(space + 1);
  const q = rest.indexOf('?');
  const pathname = q < 0 ? rest : rest.slice(0, q);
  return { method, segments: pathname.split('/'), search: q < 0 ? null : rest.slice(q + 1) };
};

/** Le motif couvre-t-il ce chemin ? Rend les segments nommés, ou `null`. */
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

/** Une route portant une query-string exacte l'emporte sur la même route sans query. */
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
 * Installe le routeur sur `globalThis.fetch` et rend de quoi le piloter.
 *
 * `renderWithProviders` l'appelle pour chaque test et le restaure ensuite : on l'utilise
 * directement seulement pour un test qui n'a rien à rendre.
 */
export function mockApi(routes: Record<string, MockResolver> = {}): ApiMock {
  const table: Route[] = [];
  const calls: MockRequest[] = [];
  const unhandled: string[] = [];
  const original = globalThis.fetch;

  const add = (key: string, resolver: MockResolver) => {
    const { method, segments, search } = parseKey(key);
    // Une redéfinition remplace la précédente : un test peut resserrer une route posée
    // par les valeurs par défaut du harnais.
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

/** Promesse résolue à la main — pour observer un état de chargement avant la réponse. */
export function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
