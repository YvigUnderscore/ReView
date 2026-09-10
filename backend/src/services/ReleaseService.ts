// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { z } from 'zod';
import { env } from '../config/env';
import { logger } from '../lib/logger';
import { safeFetch } from '../lib/safeFetch';
import { appVersion, compareSemver } from '../lib/version';

/**
 * Les versions publiées de ReView, telles que l'administration les propose.
 *
 * Ce service ne met rien à jour : il **répond à la question « quoi de neuf »**, et c'est
 * la moitié utile de l'écran — celle qui fonctionne sur toute instance, y compris celles
 * qui n'ont aucun mécanisme d'exécution installé.
 *
 * Trois principes :
 *
 *  1. **`safeFetch`, jamais `fetch` nu** (règle en tête de `lib/safeFetch.ts`) : le
 *     backend vit dans le réseau applicatif où MinIO, Redis et Postgres répondent sans
 *     authentification. `RELEASE_REPO` vient d'un `.env` d'exploitant, donc d'ailleurs.
 *  2. **Aucune exception ne remonte.** Un studio dont le pare-feu ferme le sortant doit
 *     voir « injoignable », pas un écran d'administration en erreur. L'indisponibilité
 *     est une donnée de la réponse, pas un incident.
 *  3. **Le corps des notes est du markdown distant**, donc du contenu que nous n'écrivons
 *     pas : il est borné en taille ici, et rendu échappé côté navigateur (`renderDocHtml`).
 */

/** Une release publiée, réduite à ce que l'écran affiche. */
export interface ReleaseInfo {
  /** Étiquette git, telle que publiée (`v2.4.0`). */
  tag: string;
  name: string;
  publishedAt: string | null;
  /** Notes de version, en markdown — le corps de la release GitHub. */
  notesMd: string;
  htmlUrl: string;
  prerelease: boolean;
}

/** Pourquoi le catalogue est vide, quand il l'est. */
export type ReleaseError = 'DISABLED' | 'UNREACHABLE' | 'RATE_LIMITED';

export interface ReleaseCatalog {
  releases: ReleaseInfo[];
  /** Horodatage de la dernière interrogation aboutie ; `null` si aucune. */
  checkedAt: string | null;
  error: ReleaseError | null;
}

/** Étiquette de version publiable — la même forme que celle qui déclenche `release.yml`. */
export const VERSION_TAG = /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/;

/** Le corps d'une release est de la prose : borné pour qu'un dépôt distant ne l'enfle pas. */
const MAX_NOTES_CHARS = 20_000;
/** Fenêtre de fraîcheur : une release ne paraît pas deux fois dans la demi-heure. */
const TTL_MS = 30 * 60_000;
/** Releases demandées : de quoi couvrir plusieurs versions de retard sans pagination. */
const PAGE_SIZE = 20;

const githubRelease = z.object({
  tag_name: z.string(),
  name: z.string().nullish(),
  published_at: z.string().nullish(),
  body: z.string().nullish(),
  html_url: z.string(),
  draft: z.boolean().optional(),
  prerelease: z.boolean().optional(),
});

let cache: ReleaseCatalog | null = null;
let cachedAtMs = 0;

/** Vide le cache — appelée par « Vérifier maintenant », et par les tests. */
export function invalidate(): void {
  cache = null;
  cachedAtMs = 0;
}

/** Interroge GitHub. Ne jette jamais : traduit toute panne en `ReleaseError`. */
async function fetchReleases(): Promise<ReleaseCatalog> {
  const url = `https://api.github.com/repos/${env.RELEASE_REPO}/releases?per_page=${PAGE_SIZE}`;
  const headers: Record<string, string> = {
    accept: 'application/vnd.github+json',
    'user-agent': `ReView/${appVersion.version}`,
  };
  if (env.RELEASE_GITHUB_TOKEN) headers.authorization = `Bearer ${env.RELEASE_GITHUB_TOKEN}`;

  try {
    const res = await safeFetch(
      url,
      { headers },
      // Une redirection : un dépôt renommé répond 301 vers son nouveau nom, et la garde
      // SSRF revérifie la cible du saut. 512 Kio : vingt corps de release tiennent large.
      { timeoutMs: 8_000, maxRedirects: 1, maxBytes: 512 * 1024 },
    );
    if (res.status === 403 || res.status === 429) {
      return { releases: [], checkedAt: null, error: 'RATE_LIMITED' };
    }
    if (!res.ok) return { releases: [], checkedAt: null, error: 'UNREACHABLE' };

    const parsed = z.array(githubRelease).safeParse(await res.json());
    if (!parsed.success) return { releases: [], checkedAt: null, error: 'UNREACHABLE' };

    const releases = parsed.data
      .filter((r) => r.draft !== true && VERSION_TAG.test(r.tag_name))
      .map((r) => ({
        tag: r.tag_name,
        name: r.name?.trim() || r.tag_name,
        publishedAt: r.published_at ?? null,
        notesMd: (r.body ?? '').slice(0, MAX_NOTES_CHARS),
        htmlUrl: r.html_url,
        prerelease: r.prerelease === true,
      }))
      .sort((a, b) => compareSemver(b.tag, a.tag));
    return { releases, checkedAt: new Date().toISOString(), error: null };
  } catch (err) {
    logger.warn({ err, repo: env.RELEASE_REPO }, '[Release] catalogue injoignable');
    return { releases: [], checkedAt: null, error: 'UNREACHABLE' };
  }
}

/** Le catalogue des releases, servi depuis le cache tant qu'il est frais. */
export async function catalog(options: { force?: boolean } = {}): Promise<ReleaseCatalog> {
  if (!env.RELEASE_CHECK_ENABLED) return { releases: [], checkedAt: null, error: 'DISABLED' };
  const fresh = cache !== null && Date.now() - cachedAtMs < TTL_MS;
  if (fresh && !options.force) return cache as ReleaseCatalog;

  const fetched = await fetchReleases();
  // Un échec passager ne doit pas effacer un catalogue déjà obtenu : l'écran continue de
  // montrer ce qu'il sait, en disant que la dernière vérification n'a pas abouti.
  if (fetched.error !== null && cache !== null && cache.releases.length > 0) {
    cache = { ...cache, error: fetched.error };
    return cache;
  }
  cache = fetched;
  cachedAtMs = Date.now();
  return cache;
}

/**
 * La release à proposer : la plus haute version **stable**. Une pré-version reste visible
 * dans la liste — on ne la propose pas d'un bouton, on ne la cache pas non plus.
 */
export function latestOf(releases: ReleaseInfo[]): ReleaseInfo | null {
  return releases.find((r) => !r.prerelease) ?? null;
}

/** Les releases parues depuis la version en service : ce que la mise à jour apporterait. */
export function newerThan(releases: ReleaseInfo[], installed: string): ReleaseInfo[] {
  return releases.filter((r) => compareSemver(r.tag, installed) > 0);
}

/**
 * Refuse une étiquette qui n'a pas été publiée. Contrôle d'ERGONOMIE — il évite de lancer
 * une bascule vers une version inexistante, dont l'échec ne se verrait qu'après la
 * sauvegarde. Le garde-fou de sécurité, lui, est côté agent (monotonie de version) :
 * celui-ci s'appuie sur une réponse distante, donc sur quelque chose qu'on ne maîtrise pas.
 */
export async function isPublishedTag(tag: string): Promise<boolean> {
  if (!VERSION_TAG.test(tag)) return false;
  const { releases } = await catalog();
  return releases.some((r) => r.tag === tag);
}
