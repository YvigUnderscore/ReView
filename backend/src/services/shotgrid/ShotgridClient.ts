// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Readable } from 'node:stream';
import { logger } from '../../lib/logger';
import { AppError } from '../../lib/errors';
import { safeFetch } from '../../lib/safeFetch';
import { env } from '../../config/env';
import type { SgRecord } from './shotgridMapper';

/**
 * Client for the ShotGrid / Flow Production Tracking REST API (v1.1).
 *
 * Native `fetch`, no dependency: the official client is in Python, and the surface ReView needs (authenticate, search,
 * write, transfer files) fits in a few hundred lines. v1.1 is required: v1 returns decimals as strings and loses time zones.
 */

export const SG_API_PATH = '/api/v1.1';

/**
 * Content types for ShotGrid searches. The `_search` endpoint refuses `application/json`: it requires knowing whether the
 * filters arrive as an array of conditions or as an object with a logical operator, and announces it through the Content-Type.
 */
export const SG_FILTER_ARRAY_TYPE = 'application/vnd+shotgun.api3_array+json';
export const SG_FILTER_HASH_TYPE = 'application/vnd+shotgun.api3_hash+json';

export type SgAuthMode = 'script' | 'user';

export interface ShotgridCredentials {
  baseUrl: string;
  authMode: SgAuthMode;
  scriptName?: string | null;
  scriptKey?: string | null;
  login?: string | null;
  password?: string | null;
}

export interface ShotgridErrorOptions {
  /** Confirmed authentication refusal: set by `token()`, never inferred from the HTTP code. */
  auth?: boolean;
  /** Stable code that the interface translates (`error.<CODE>` in the front-end catalog). */
  code?: string;
  /** Data returned to the client: notably `reason`, the site's own words. */
  details?: Record<string, unknown>;
}

/**
 * Error coming from a ShotGrid site.
 *
 * Two codes coexist without being confused: `status` is the one returned by the SITE, `statusCode` (inherited from
 * `AppError`) is the one ReView returns to its own client, always 502: it is the gateway that failed, not the user's request.
 *
 * Inheriting from `AppError` is the point: a bare `Error` ended up as "Internal server error" on screen, and the administrator
 * had to open the backend logs to learn that their ShotGrid account was locked. The message and code now reach the interface.
 */
export class ShotgridApiError extends AppError {
  private readonly authRefused: boolean;

  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown,
    options: ShotgridErrorOptions = {},
  ) {
    super(message, 502, options.code, options.details);
    this.name = 'ShotgridApiError';
    this.authRefused = options.auth ?? false;
  }

  /**
   * Credentials refused: the connection must switch to `auth_error`, not retry in a loop. The HTTP code is not enough to say
   * so: a real site answers **400** with `code: 102` ("Can't authenticate user ...") where the documentation leads one to
   * expect a 401. Hence the flag, set at the source by `token()`.
   */
  get isAuth(): boolean {
    return this.authRefused || this.status === 401 || this.status === 403;
  }
}

export type SgFilter = [string, string, unknown];

export interface SearchOptions {
  fields?: string[];
  filters?: SgFilter[];
  /** Combination of the filters: ShotGrid accepts "and" (default) or "or". */
  logicalOperator?: 'and' | 'or';
  sort?: string;
  pageSize?: number;
  /** Safety cap: prevents a huge project from blocking a synchronization. */
  maxRecords?: number;
}

interface TokenState {
  accessToken: string;
  expiresAt: number;
}

/** Tokens shared per site: several projects on the same site reuse the session. */
const tokenCache = new Map<string, TokenState>();

/**
 * Authentication refusal remembered per site: the circuit breaker.
 *
 * A ShotGrid site **locks the account** after a few failures, and ReView could produce twenty in fifteen seconds: each screen
 * requested its token for its account. A typo in the password therefore ended in a locked account, which no local correction
 * could unlock. A refusal now closes the door for the whole site for `AUTH_BLOCK_MS` and is replayed without calling anyone;
 * fixing the credentials goes through `clearTokenCache`, which reopens at once.
 */
const authBlocks = new Map<string, { error: ShotgridApiError; until: number }>();

export function clearTokenCache(baseUrl?: string): void {
  if (baseUrl) {
    tokenCache.delete(baseUrl);
    authBlocks.delete(baseUrl);
  } else {
    tokenCache.clear();
    authBlocks.clear();
  }
}

const DEFAULT_TIMEOUT_MS = 30_000;
/**
 * Duration during which an authentication refusal applies to the whole site: long enough that a burst of screens counts as
 * only one attempt, short enough that an account unlocked on the studio side resumes without restarting ReView.
 */
const AUTH_BLOCK_MS = 5 * 60_000;
const MAX_PAGE_SIZE = 500;
/** A page of 500 records weighs a few megabytes; 32 MiB leaves a margin. */
const MAX_JSON_BYTES = 32 * 1024 * 1024;
/** Minimum throughput retained to bound a file upload: about 100 KiB/s. */
const UPLOAD_MIN_BYTES_PER_MS = 100;

/**
 * Hosts exempted from the anti-SSRF guard (`SHOTGRID_INSECURE_HOSTS`).
 *
 * The development simulator lives on `host.docker.internal:8890`, so on a private address over HTTP: without this list, no
 * end-to-end test would pass. It is empty by default and loudly flagged at startup: a real site never needs it.
 * Read on each call rather than frozen at module load, so that tests can vary it.
 */
function insecureHosts(): string[] {
  return (env.SHOTGRID_INSECURE_HOSTS ?? '')
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean);
}

export class ShotgridClient {
  constructor(
    private readonly creds: ShotgridCredentials,
    private readonly timeoutMs = DEFAULT_TIMEOUT_MS,
  ) {}

  get baseUrl(): string {
    return this.creds.baseUrl.replace(/\/$/, '');
  }

  // ───────────────────────────── Authentication ─────────────────────────────

  /**
   * Access token (Bearer). The refresh chain is not followed: ShotGrid's refresh_token values are single-use and are lost on the
   * slightest concurrent call; re-authenticating costs one request and cannot diverge.
   *
   * A refusal, for its part, is not retried: it is remembered for the site (`authBlocks`) and replayed as is for a few minutes.
   * Retrying refused credentials does not make them good, and the site counts failures to lock the account.
   */
  private async token(): Promise<string> {
    const cached = tokenCache.get(this.baseUrl);
    if (cached && cached.expiresAt > Date.now() + 30_000) return cached.accessToken;

    const blocked = authBlocks.get(this.baseUrl);
    if (blocked) {
      if (blocked.until > Date.now()) {
        logger.warn(
          { baseUrl: this.baseUrl, retryInMs: blocked.until - Date.now() },
          'Authentification ShotGrid déjà refusée pour ce site — requête non émise',
        );
        // A new instance rather than the same: the stack points at the call that failed here,
        // not at the one from three minutes ago.
        throw new ShotgridApiError(blocked.error.message, blocked.error.status, blocked.error.body, {
          auth: true,
          code: blocked.error.code,
          details: blocked.error.details,
        });
      }
      authBlocks.delete(this.baseUrl);
    }

    const body = new URLSearchParams();
    if (this.creds.authMode === 'user') {
      if (!this.creds.login || !this.creds.password)
        throw new ShotgridApiError('No ShotGrid user credentials recorded for this site', 401, null, {
          auth: true,
          code: 'SHOTGRID_NOT_CONFIGURED',
        });
      body.set('grant_type', 'password');
      body.set('username', this.creds.login);
      body.set('password', this.creds.password);
    } else {
      if (!this.creds.scriptName || !this.creds.scriptKey)
        throw new ShotgridApiError('No ShotGrid script credentials recorded for this site', 401, null, {
          auth: true,
          code: 'SHOTGRID_NOT_CONFIGURED',
        });
      body.set('grant_type', 'client_credentials');
      body.set('client_id', this.creds.scriptName);
      body.set('client_secret', this.creds.scriptKey);
    }

    const res = await this.raw(`${SG_API_PATH}/auth/access_token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: body.toString(),
    });
    if (!res.ok) {
      const detail = await safeJson(res);
      /**
       * The site's words, not ours: "Can't authenticate user 'x'" and "... because the account is locked" call for two different
       * actions, and the generic label confused them. The reason therefore goes up to the screen (`details.reason`).
       */
      const reason = sgErrorMessage(detail, res.status);
      const hint =
        this.creds.authMode === 'user'
          ? 'check the Legacy Login and the Personal Access Token linked to this site'
          : 'check the script name and key';
      const error = new ShotgridApiError(
        `ShotGrid refused the credentials: ${reason} — ${hint}`,
        res.status,
        detail,
        { auth: true, code: 'SHOTGRID_AUTH_REFUSED', details: { reason } },
      );
      /**
       * The refusal is logged here, at the moment the site pronounces it: this is the only occasion. The replay from `authBlocks`
       * can only say "already refused"; the reason (locked account, expired token, wrong login) lived only in the response rendered
       * to the browser, hence invisible from the logs. Diagnosing a connection that does not go through required replaying the call by hand.
       */
      logger.warn(
        { baseUrl: this.baseUrl, status: res.status, authMode: this.creds.authMode, reason },
        'Authentification ShotGrid refusée par le site',
      );
      authBlocks.set(this.baseUrl, { error, until: Date.now() + AUTH_BLOCK_MS });
      throw error;
    }
    const json = (await res.json()) as { access_token: string; expires_in?: number };
    const expiresIn = typeof json.expires_in === 'number' ? json.expires_in : 600;
    tokenCache.set(this.baseUrl, {
      accessToken: json.access_token,
      expiresAt: Date.now() + expiresIn * 1000,
    });
    return json.access_token;
  }

  // ───────────────────────────── Transport ─────────────────────────────

  /**
   * Every outgoing request from the client goes through `safeFetch`: the site is configured by an admin, but the address it
   * carries is not thereby trustworthy (a public name may resolve to 169.254.169.254), and some targets (the upload address,
   * the download address) are dictated outright by the remote site.
   *
   * `path` is normally relative to the site's root; ShotGrid does however sometimes return an ABSOLUTE address (`links.complete_upload`).
   * Concatenating it produced an unusable URL: we recognize it and use it as is, under guard.
   */
  private async raw(path: string, init: RequestInit): Promise<Response> {
    const url = /^https?:\/\//i.test(path) ? path : `${this.baseUrl}${path}`;
    return safeFetch(url, init, {
      timeoutMs: this.timeoutMs,
      maxBytes: MAX_JSON_BYTES,
      allowHosts: insecureHosts(),
    });
  }

  /**
   * Authenticated request with retry. ShotGrid does not document a firm quota but degrades the site under load: we back off on
   * 429 and on transient errors, and never retry a refused authentication.
   */
  private async request<T>(path: string, init: RequestInit & { retries?: number } = {}): Promise<T> {
    const { retries = 3, ...rest } = init;
    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const token = await this.token();
      const res = await this.raw(path, {
        ...rest,
        headers: {
          Accept: 'application/json',
          // Content-Type only when there is a body: a real ShotGrid site refuses the header on a request without a payload
          // ("Unsupported Content-Type"), where a permissive server ignores it.
          ...(rest.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(rest.headers ?? {}),
          Authorization: `Bearer ${token}`,
        },
      });
      if (res.ok) return (await safeJson(res)) as T;

      const body = await safeJson(res);
      if (res.status === 401) {
        // Token expired server-side: discard it and retry once.
        tokenCache.delete(this.baseUrl);
        if (attempt === 0) continue;
      }
      const error = new ShotgridApiError(sgErrorMessage(body, res.status), res.status, body);
      if (res.status === 429 || res.status >= 500) {
        lastError = error;
        const wait = Math.min(2 ** attempt * 500, 8_000);
        logger.warn(
          { status: res.status, attempt, wait, path },
          'ShotGrid a répondu une erreur transitoire, nouvelle tentative',
        );
        await sleep(wait);
        continue;
      }
      throw error;
    }
    throw lastError instanceof Error
      ? lastError
      : new ShotgridApiError('ShotGrid injoignable', 503, lastError);
  }

  // ───────────────────────────── Read ─────────────────────────────

  /** Server information: used for the connection test. */
  async serverInfo(): Promise<Record<string, unknown>> {
    const json = await this.request<{ data?: Record<string, unknown> }>(`${SG_API_PATH}/`);
    return json.data ?? {};
  }

  /**
   * Paginated search. Returns all pages up to `maxRecords`: callers work on complete lists, pagination is a transport detail.
   */
  async search(entity: string, options: SearchOptions = {}): Promise<SgRecord[]> {
    const pageSize = Math.min(options.pageSize ?? MAX_PAGE_SIZE, MAX_PAGE_SIZE);
    const out: SgRecord[] = [];
    let page = 1;
    for (;;) {
      const payload: Record<string, unknown> = { page: { size: pageSize, number: page } };
      if (options.fields?.length) payload.fields = options.fields;
      if (options.sort) payload.sort = options.sort;

      /**
       * The search requires a proprietary content type that declares the SHAPE of the filters, and refuses `application/json`:
       * the array of conditions and the object with a logical operator each have their own. ShotGrid does not guess.
       */
      const useHash = Boolean(options.logicalOperator);
      if (useHash) {
        payload.filters = {
          logical_operator: options.logicalOperator,
          conditions: options.filters ?? [],
        };
      } else {
        payload.filters = options.filters ?? [];
      }

      const json = await this.request<{ data?: unknown[] }>(
        `${SG_API_PATH}/entity/${encodeURIComponent(entity)}/_search`,
        {
          method: 'POST',
          body: JSON.stringify(payload),
          headers: {
            'Content-Type': useHash ? SG_FILTER_HASH_TYPE : SG_FILTER_ARRAY_TYPE,
          },
        },
      );
      const batch = (json.data ?? []).map(flattenRecord);
      out.push(...batch);
      if (batch.length < pageSize) break;
      if (options.maxRecords && out.length >= options.maxRecords) break;
      page += 1;
      if (page > 200) {
        logger.warn({ entity, count: out.length }, 'Pagination ShotGrid interrompue au plafond');
        break;
      }
    }
    return options.maxRecords ? out.slice(0, options.maxRecords) : out;
  }

  async findById(entity: string, id: number, fields: string[]): Promise<SgRecord | null> {
    try {
      const json = await this.request<{ data?: unknown }>(
        `${SG_API_PATH}/entity/${encodeURIComponent(entity)}/${id}?fields=${encodeURIComponent(fields.join(','))}`,
      );
      return json.data ? flattenRecord(json.data) : null;
    } catch (err) {
      if (err instanceof ShotgridApiError && err.status === 404) return null;
      throw err;
    }
  }

  /** Schema of a field: used to read the possible values of `sg_status_list`. */
  async schemaField(entity: string, field: string): Promise<Record<string, unknown> | null> {
    try {
      const json = await this.request<{ data?: Record<string, unknown> }>(
        `${SG_API_PATH}/schema/${encodeURIComponent(entity)}/fields/${encodeURIComponent(field)}`,
      );
      return json.data ?? null;
    } catch (err) {
      // A field absent from the site is not an error: the site simply does not have that field.
      if (err instanceof ShotgridApiError && err.status === 404) return null;
      throw err;
    }
  }

  /** Existing fields of an entity: allows asking only for what the site knows. */
  async schemaFields(entity: string): Promise<Set<string>> {
    const json = await this.request<{ data?: Record<string, unknown> }>(
      `${SG_API_PATH}/schema/${encodeURIComponent(entity)}/fields`,
    );
    return new Set(Object.keys(json.data ?? {}));
  }

  // ───────────────────────────── Write ─────────────────────────────

  /**
   * ⚠ Raw write. **Do not call directly**: go through `ShotgridWriter`, which sets the linked project and re-reads what the site wrote.
   * `ShotgridWriteGuard.test.ts` makes the suite fail if an `unsafe*` reappears outside this writer.
   */
  async unsafeCreate(
    entity: string,
    data: Record<string, unknown>,
    asUserLogin?: string | null,
  ): Promise<SgRecord> {
    const query = asUserLogin ? `?sudo_as_login=${encodeURIComponent(asUserLogin)}` : '';
    const json = await this.request<{ data?: unknown }>(
      `${SG_API_PATH}/entity/${encodeURIComponent(entity)}${query}`,
      { method: 'POST', body: JSON.stringify(data) },
    );
    return flattenRecord(json.data);
  }

  /** ⚠ Raw write: see `unsafeCreate`. */
  async unsafeUpdate(
    entity: string,
    id: number,
    data: Record<string, unknown>,
    options: { asUserLogin?: string | null } = {},
  ): Promise<SgRecord> {
    const query = options.asUserLogin ? `?sudo_as_login=${encodeURIComponent(options.asUserLogin)}` : '';
    const json = await this.request<{ data?: unknown }>(
      `${SG_API_PATH}/entity/${encodeURIComponent(entity)}/${id}${query}`,
      { method: 'PUT', body: JSON.stringify(data) },
    );
    return flattenRecord(json.data);
  }

  /** ⚠ Raw write: see `unsafeCreate`. Removes an entity from the site. */
  async unsafeRemove(entity: string, id: number): Promise<void> {
    await this.request(`${SG_API_PATH}/entity/${encodeURIComponent(entity)}/${id}`, {
      method: 'DELETE',
      retries: 0,
    });
  }

  // ───────────────────────────── Files ─────────────────────────────

  /**
   * Download stream of a media. The URLs returned by ShotGrid are signed S3 links with a very short lifetime: they are consumed
   * immediately, and never held in memory: a dailies master does not fit in a worker's heap.
   */
  /**
   * Download address of a file field.
   *
   * The dedicated endpoint is not served by every site nor for every field: a 404 means "no content at this address", not
   * "the synchronization failed". We then return `null` and the caller falls back to the address that ShotGrid has often already
   * placed in the field itself.
   */
  async downloadUrl(entity: string, id: number, field: string): Promise<string | null> {
    try {
      const json = await this.request<{ data?: { url?: string } }>(
        `${SG_API_PATH}/entity/${encodeURIComponent(entity)}/${id}/${encodeURIComponent(field)}/download?redirect=false`,
        { retries: 0 },
      );
      return json.data?.url ?? null;
    } catch (err) {
      if (err instanceof ShotgridApiError && (err.status === 404 || err.status === 400)) return null;
      throw err;
    }
  }

  /**
   * The address comes from the site's RESPONSE (`downloadUrl`, or the raw value of the field): it is an untrusted input, which a
   * compromised site could point at the metadata service or the MinIO console. Hence the guard, the timeout, and counted redirects:
   * signed S3 links emit one, and each hop is rechecked. No size cap here: a dailies master weighs what it weighs, and the stream
   * is consumed on the fly by the caller.
   */
  async openStream(url: string): Promise<{ stream: Readable; size: number | null; type: string | null }> {
    const res = await safeFetch(
      url,
      {},
      { timeoutMs: this.timeoutMs, maxRedirects: 3, allowHosts: insecureHosts() },
    );
    if (!res.ok || !res.body)
      throw new ShotgridApiError('Téléchargement du média ShotGrid impossible', res.status);
    const len = res.headers.get('content-length');
    return {
      stream: Readable.fromWeb(res.body),
      size: len ? Number.parseInt(len, 10) : null,
      type: res.headers.get('content-type'),
    };
  }

  /**
   * Sends a file into a field (Version.sg_uploaded_movie, Note.attachments): ShotGrid issues a signed URL, the content is deposited
   * there, then the upload is confirmed.
   */
  async unsafeUploadFile(
    entity: string,
    id: number,
    field: string,
    body: Buffer,
    filename: string,
    contentType = 'application/octet-stream',
  ): Promise<void> {
    // ShotGrid describes the upload in `links`, not in `data`: `data` only carries the description of the upload (type,
    // storage service), and the signed S3 address lives under `links.upload`. Looking up `data.upload_url` always returned empty,
    // hence "no upload URL" when the site had indeed provided one.
    const init = await this.request<{
      data?: Record<string, unknown>;
      links?: { upload?: string; complete_upload?: string };
    }>(
      `${SG_API_PATH}/entity/${encodeURIComponent(entity)}/${id}/${encodeURIComponent(field)}/_upload?filename=${encodeURIComponent(filename)}`,
    );
    const uploadUrl = init.links?.upload;
    if (!uploadUrl) throw new ShotgridApiError("ShotGrid n'a pas fourni d'URL de dépôt", 502, init);

    // The upload address is chosen by the site: under guard too, and without following any redirect: replaying a PUT elsewhere
    // would amount to entrusting the file to that target.
    //
    // The response to a PUT only arrives once the whole body has been transmitted: the timeout therefore cannot be that of an API
    // call. It is set from a minimum throughput (100 KiB/s) plus a minute of margin: a dailies master thus has the time it needs,
    // without a blocked upload being able to hold the worker indefinitely.
    const put = await safeFetch(
      uploadUrl,
      {
        method: 'PUT',
        headers: { 'Content-Type': contentType },
        body: new Uint8Array(body),
      },
      {
        timeoutMs: 60_000 + Math.ceil(body.length / UPLOAD_MIN_BYTES_PER_MS),
        allowHosts: insecureHosts(),
      },
    );
    if (!put.ok) throw new ShotgridApiError('Dépôt du fichier vers ShotGrid refusé', put.status);

    // The confirmation makes the file visible in the interface: without it, the object stays on storage without
    // being attached to the entity.
    const complete = init.links?.complete_upload;
    if (complete) {
      await this.request(complete, {
        method: 'POST',
        body: JSON.stringify({ upload_info: init.data, upload_data: {} }),
      });
    }
  }
}

// ───────────────────────────── Utilities ─────────────────────────────

/**
 * JSONAPI to flat object. ShotGrid puts simple fields in `attributes` and entity links in `relationships`; the services want a
 * single record, as the Python API returns it.
 */
export function flattenRecord(raw: unknown): SgRecord {
  const rec = (raw ?? {}) as Record<string, unknown>;
  const attributes = (rec.attributes ?? {}) as Record<string, unknown>;
  const relationships = (rec.relationships ?? {}) as Record<string, unknown>;
  const out: SgRecord = {
    id: typeof rec.id === 'number' ? rec.id : Number(rec.id ?? 0),
    type: typeof rec.type === 'string' ? rec.type : '',
    ...attributes,
  };
  for (const [name, value] of Object.entries(relationships)) {
    const data = (value as { data?: unknown } | null)?.data;
    if (data !== undefined) out[name] = data;
  }
  // Some sites already return flat fields: we do not overwrite them.
  for (const [name, value] of Object.entries(rec)) {
    if (name !== 'attributes' && name !== 'relationships' && !(name in out)) out[name] = value;
  }
  return out;
}

function sgErrorMessage(body: unknown, status: number): string {
  const errors = (body as { errors?: Array<{ title?: string; detail?: string }> })?.errors;
  if (Array.isArray(errors) && errors.length > 0) {
    const first = errors[0]!;
    return first.detail ?? first.title ?? `Erreur ShotGrid ${status}`;
  }
  return `Erreur ShotGrid ${status}`;
}

async function safeJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
