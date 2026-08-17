// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Readable } from 'node:stream';
import { logger } from '../../lib/logger';
import type { SgRecord } from './shotgridMapper';

/**
 * Client de l'API REST ShotGrid / Flow Production Tracking (v1.1).
 *
 * `fetch` natif, aucune dépendance : le client officiel est en Python, et la surface
 * dont ReView a besoin (authentifier, chercher, écrire, transférer des fichiers) tient
 * en quelques centaines de lignes. La v1.1 est exigée — la v1 renvoie les décimaux en
 * chaînes et perd les fuseaux horaires.
 */

export const SG_API_PATH = '/api/v1.1';

/**
 * Types de contenu de la recherche ShotGrid. L'endpoint `_search` refuse
 * `application/json` : il exige de savoir si les filtres arrivent sous forme de tableau
 * de conditions ou d'objet à opérateur logique, et l'annonce par le Content-Type.
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

export class ShotgridApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ShotgridApiError';
  }

  /** Identifiants refusés : la connexion doit passer en `auth_error`, pas retenter en boucle. */
  get isAuth(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

export type SgFilter = [string, string, unknown];

export interface SearchOptions {
  fields?: string[];
  filters?: SgFilter[];
  /** Combinaison des filtres — ShotGrid accepte « and » (défaut) ou « or ». */
  logicalOperator?: 'and' | 'or';
  sort?: string;
  pageSize?: number;
  /** Plafond de sécurité : évite qu'un projet géant bloque une synchronisation. */
  maxRecords?: number;
}

interface TokenState {
  accessToken: string;
  expiresAt: number;
}

/** Jetons partagés par site : plusieurs projets d'un même site réutilisent la session. */
const tokenCache = new Map<string, TokenState>();

export function clearTokenCache(baseUrl?: string): void {
  if (baseUrl) tokenCache.delete(baseUrl);
  else tokenCache.clear();
}

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_PAGE_SIZE = 500;

export class ShotgridClient {
  constructor(
    private readonly creds: ShotgridCredentials,
    private readonly timeoutMs = DEFAULT_TIMEOUT_MS,
  ) {}

  get baseUrl(): string {
    return this.creds.baseUrl.replace(/\/$/, '');
  }

  // ───────────────────────────── Authentification ─────────────────────────────

  /**
   * Jeton d'accès (Bearer). On ne suit pas la chaîne de rafraîchissement : les
   * refresh_token de ShotGrid sont à usage unique et se perdent au moindre appel
   * concurrent — se ré-authentifier coûte une requête et ne peut pas diverger.
   */
  private async token(): Promise<string> {
    const cached = tokenCache.get(this.baseUrl);
    if (cached && cached.expiresAt > Date.now() + 30_000) return cached.accessToken;

    const body = new URLSearchParams();
    if (this.creds.authMode === 'user') {
      if (!this.creds.login || !this.creds.password)
        throw new ShotgridApiError('Identifiants utilisateur ShotGrid manquants', 401);
      body.set('grant_type', 'password');
      body.set('username', this.creds.login);
      body.set('password', this.creds.password);
    } else {
      if (!this.creds.scriptName || !this.creds.scriptKey)
        throw new ShotgridApiError('Script ShotGrid non configuré', 401);
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
      throw new ShotgridApiError(
        this.creds.authMode === 'user'
          ? 'Authentification ShotGrid refusée — vérifier le Legacy Login et le Personal Access Token lié au site'
          : 'Authentification ShotGrid refusée — vérifier le nom et la clé du script',
        res.status,
        detail,
      );
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

  private async raw(path: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await fetch(`${this.baseUrl}${path}`, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Requête authentifiée avec reprise. ShotGrid ne documente pas de quota ferme mais
   * dégrade le site sous charge : on lève le pied sur 429 et sur les erreurs
   * passagères, et on ne retente jamais une authentification refusée.
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
          // Content-Type seulement quand il y a un corps : un site ShotGrid réel
          // refuse l'en-tête sur une requête sans charge utile (« Unsupported
          // Content-Type »), là où un serveur permissif l'ignore.
          ...(rest.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(rest.headers ?? {}),
          Authorization: `Bearer ${token}`,
        },
      });
      if (res.ok) return (await safeJson(res)) as T;

      const body = await safeJson(res);
      if (res.status === 401) {
        // Jeton périmé côté serveur : on le jette et on retente une fois.
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

  // ───────────────────────────── Lecture ─────────────────────────────

  /** Informations du serveur — sert au test de connexion. */
  async serverInfo(): Promise<Record<string, unknown>> {
    const json = await this.request<{ data?: Record<string, unknown> }>(`${SG_API_PATH}/`);
    return json.data ?? {};
  }

  /**
   * Recherche paginée. Renvoie toutes les pages jusqu'à `maxRecords` : les appelants
   * travaillent sur des listes complètes, la pagination est un détail de transport.
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
       * La recherche exige un type de contenu propriétaire qui déclare la FORME des
       * filtres, et refuse `application/json` : le tableau de conditions et l'objet à
       * opérateur logique ont chacun le leur. ShotGrid ne le devine pas.
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

  /** Schéma d'un champ — sert à lire les valeurs possibles de `sg_status_list`. */
  async schemaField(entity: string, field: string): Promise<Record<string, unknown> | null> {
    try {
      const json = await this.request<{ data?: Record<string, unknown> }>(
        `${SG_API_PATH}/schema/${encodeURIComponent(entity)}/fields/${encodeURIComponent(field)}`,
      );
      return json.data ?? null;
    } catch (err) {
      // Un champ absent du site n'est pas une erreur : le site n'a simplement pas ce champ.
      if (err instanceof ShotgridApiError && err.status === 404) return null;
      throw err;
    }
  }

  /** Champs existants d'une entité : permet de ne demander que ce que le site connaît. */
  async schemaFields(entity: string): Promise<Set<string>> {
    const json = await this.request<{ data?: Record<string, unknown> }>(
      `${SG_API_PATH}/schema/${encodeURIComponent(entity)}/fields`,
    );
    return new Set(Object.keys(json.data ?? {}));
  }

  // ───────────────────────────── Écriture ─────────────────────────────

  async create(entity: string, data: Record<string, unknown>): Promise<SgRecord> {
    const json = await this.request<{ data?: unknown }>(
      `${SG_API_PATH}/entity/${encodeURIComponent(entity)}`,
      { method: 'POST', body: JSON.stringify(data) },
    );
    return flattenRecord(json.data);
  }

  async update(
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

  /** Retire une entité du site (mise à la corbeille ShotGrid). */
  async remove(entity: string, id: number): Promise<void> {
    await this.request(`${SG_API_PATH}/entity/${encodeURIComponent(entity)}/${id}`, {
      method: 'DELETE',
      retries: 0,
    });
  }

  async createAs(
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

  // ───────────────────────────── Fichiers ─────────────────────────────

  /**
   * Flux de téléchargement d'un média. Les URL renvoyées par ShotGrid sont des liens
   * S3 signés à durée très courte : on les consomme immédiatement, et jamais en
   * mémoire — un master de dailies ne tient pas dans le tas d'un worker.
   */
  /**
   * Adresse de téléchargement d'un champ fichier.
   *
   * L'endpoint dédié n'est pas servi par tous les sites ni pour tous les champs : un
   * 404 signifie « pas de contenu à cette adresse », pas « la synchronisation a
   * échoué ». On rend alors `null` et l'appelant se rabat sur l'adresse que ShotGrid
   * a souvent déjà placée dans le champ lui-même.
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

  async openStream(url: string): Promise<{ stream: Readable; size: number | null; type: string | null }> {
    const res = await fetch(url);
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
   * Envoi d'un fichier dans un champ (Version.sg_uploaded_movie, Note.attachments) :
   * ShotGrid délivre une URL signée, on y dépose le contenu, puis on confirme.
   */
  async uploadFile(
    entity: string,
    id: number,
    field: string,
    body: Buffer,
    filename: string,
    contentType = 'application/octet-stream',
  ): Promise<void> {
    // ShotGrid décrit le dépôt dans `links`, pas dans `data` : `data` ne porte que la
    // description de l'envoi (type, service de stockage), et l'adresse signée S3 vit
    // sous `links.upload`. Chercher `data.upload_url` renvoyait toujours vide, donc
    // « pas d'URL de dépôt » alors que le site en avait bien fourni une.
    const init = await this.request<{
      data?: Record<string, unknown>;
      links?: { upload?: string; complete_upload?: string };
    }>(
      `${SG_API_PATH}/entity/${encodeURIComponent(entity)}/${id}/${encodeURIComponent(field)}/_upload?filename=${encodeURIComponent(filename)}`,
    );
    const uploadUrl = init.links?.upload;
    if (!uploadUrl) throw new ShotgridApiError("ShotGrid n'a pas fourni d'URL de dépôt", 502, init);

    const put = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      body: new Uint8Array(body),
    });
    if (!put.ok) throw new ShotgridApiError('Dépôt du fichier vers ShotGrid refusé', put.status);

    // La confirmation rend le fichier visible dans l'interface : sans elle, l'objet
    // reste sur le stockage sans être rattaché à l'entité.
    const complete = init.links?.complete_upload;
    if (complete) {
      await this.request(complete, {
        method: 'POST',
        body: JSON.stringify({ upload_info: init.data, upload_data: {} }),
      });
    }
  }
}

// ───────────────────────────── Utilitaires ─────────────────────────────

/**
 * JSONAPI → objet plat. ShotGrid range les champs simples dans `attributes` et les
 * liens d'entités dans `relationships` ; les services veulent un enregistrement unique,
 * comme le renvoie l'API Python.
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
  // Certains sites renvoient déjà des champs à plat : on ne les écrase pas.
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
