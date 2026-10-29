// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/prisma';
import { storage } from './StorageService';
import { badRequest, notFound } from '../lib/errors';
import {
  acesDisplayName,
  isDefaultCandidate,
  parseAcesAsset,
  type AcesAssetInfo,
  type AcesConfigKind,
} from '../lib/ocioAces';
import { isValidDisplayView, parseOcioDisplays, type OcioDisplay } from '../lib/ocioDisplays';
import {
  bakeBuiltinLut,
  BUILTIN_SOURCE,
  LUT_SIZE,
  lutPrefix,
  lutStorageKey,
  serializeCube,
} from '../lib/ocioBake';
import { enqueueOcioBake } from '../workers/ocio/queue';
import { fetchAllowlisted, readCappedBody } from '../lib/httpFetch';

/**
 * Catalogue of OCIO colour configs (39.B). The official ACES configs are fetched from the **ASWF GitHub
 * releases** (`OpenColorIO-Config-ACES`) then installed in MinIO (`studio/ocio/`). The inventory of installed
 * configs lives in a JSON `Setting` (`ocioLibrary`) — no migration, same pattern as the HDRI library. Product
 * default: **ACES 1.3**.
 *
 * Security (CP-SEC): the repository is **fixed** (no URL supplied by the user); we only install assets
 * returned by the GitHub API, whose download host is **allow-listed**,
 * with a size ceiling. The `.ocio` files are YAML stored as is (never executed).
 *
 * These two requests leave the API process, INSIDE the application network: they therefore go through
 * `fetchAllowlisted` (lib/httpFetch) and not through `fetch`. The allow-list alone was not
 * enough — GitHub serves its assets through a 302 redirect, which `fetch` followed blindly: a hostile
 * upstream (or resolver) redirected the request to `169.254.169.254` or `minio:9000`, and the content
 * obtained was filed as an "OCIO config". Each hop is now re-submitted to the SSRF guard and the allow-list,
 * with a timeout and a bounded size.
 */

const SETTING_KEY = 'ocioLibrary';
const OCIO_REPO = 'AcademySoftwareFoundation/OpenColorIO-Config-ACES';
const GITHUB_API = 'https://api.github.com';
const ALLOWED_API_HOSTS = new Set(['api.github.com']);
const ALLOWED_ASSET_HOSTS = new Set([
  'github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
]);
const MAX_ASSET_BYTES = 25 * 1024 * 1024; // 25 MB (ACES configs are under 1 MB)
/** Fifteen releases with their assets: a few hundred KB, never two. */
const MAX_RELEASES_BYTES = 2 * 1024 * 1024;
const RELEASES_TTL_MS = 10 * 60 * 1000;
/** Neither the catalogue nor the download may be able to hold a request worker. */
const OUTBOUND_TIMEOUT_MS = 15_000;

/** Injectable exit gate (tests) — by default the hardened exit of `lib/httpFetch`. */
export type OutboundFetch = typeof fetchAllowlisted;

export interface OcioEntry {
  id: string;
  name: string;
  kind: AcesConfigKind;
  acesVersion: string;
  ocioVersion: string;
  configVersion: string;
  releaseTag: string;
  assetName: string;
  storageKey: string;
  sizeBytes: number;
  createdAt: string;
  isDefault: boolean;
}

/** (Partial) shape of a GitHub release. */
interface GithubRelease {
  tag_name: string;
  name: string | null;
  published_at: string | null;
  assets: { name: string; browser_download_url: string; size: number }[];
}

/** ACES asset exposed to the admin catalogue. */
export interface OcioCatalogAsset {
  assetName: string;
  downloadUrl: string;
  sizeBytes: number;
  info: AcesAssetInfo;
  label: string;
  installed: boolean;
  recommendedDefault: boolean;
}

/** An ACES release with its recognised config assets. */
export interface OcioReleaseEntry {
  tag: string;
  name: string;
  publishedAt: string | null;
  assets: OcioCatalogAsset[];
}

/** Builds the catalogue (pure): keeps only releases carrying ≥1 recognised `.ocio` asset. */
export function buildReleaseCatalog(
  releases: GithubRelease[],
  installedAssetNames: Set<string>,
): OcioReleaseEntry[] {
  const out: OcioReleaseEntry[] = [];
  for (const r of releases) {
    const assets: OcioCatalogAsset[] = [];
    for (const a of r.assets) {
      const info = parseAcesAsset(a.name);
      if (!info) continue;
      assets.push({
        assetName: a.name,
        downloadUrl: a.browser_download_url,
        sizeBytes: a.size,
        info,
        label: acesDisplayName(info),
        installed: installedAssetNames.has(a.name),
        recommendedDefault: isDefaultCandidate(info),
      });
    }
    if (assets.length > 0) {
      out.push({ tag: r.tag_name, name: r.name ?? r.tag_name, publishedAt: r.published_at, assets });
    }
  }
  return out;
}

/** True if the download URL's host is allowed (anti-SSRF). */
export function isAllowedAssetHost(url: string): boolean {
  try {
    return ALLOWED_ASSET_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

async function readLibrary(): Promise<OcioEntry[]> {
  const setting = await prisma.setting.findUnique({ where: { key: SETTING_KEY } });
  if (!setting) return [];
  try {
    const parsed = JSON.parse(setting.value) as OcioEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeLibrary(entries: OcioEntry[]): Promise<void> {
  await prisma.setting.upsert({
    where: { key: SETTING_KEY },
    update: { value: JSON.stringify(entries) },
    create: { key: SETTING_KEY, value: JSON.stringify(entries) },
  });
}

let releasesCache: { at: number; data: GithubRelease[] } | null = null;

/** Fetches (with a 10 min cache) the ACES releases from GitHub. `fetchFn` injectable (tests). */
async function fetchReleases(fetchFn: OutboundFetch): Promise<GithubRelease[]> {
  if (releasesCache && Date.now() - releasesCache.at < RELEASES_TTL_MS) return releasesCache.data;
  const res = await fetchFn(
    `${GITHUB_API}/repos/${OCIO_REPO}/releases?per_page=15`,
    { headers: { accept: 'application/vnd.github+json', 'user-agent': 'ReView-app' } },
    // The GitHub API does not redirect: a redirect here is not a use case, it is a hijacking.
    {
      isAllowedHost: (url) => ALLOWED_API_HOSTS.has(url.hostname),
      timeoutMs: OUTBOUND_TIMEOUT_MS,
      maxRedirects: 0,
    },
  );
  if (!res.ok) throw badRequest(`GitHub answered ${res.status}`, 'OCIO_RELEASES_FAILED');
  const body = await readCappedBody(res, MAX_RELEASES_BYTES, GITHUB_API);
  let data: GithubRelease[];
  try {
    data = JSON.parse(body.toString('utf-8')) as GithubRelease[];
  } catch {
    throw badRequest('GitHub returned an unreadable payload', 'OCIO_RELEASES_FAILED');
  }
  releasesCache = { at: Date.now(), data };
  return data;
}

/** Resets the release cache (tests). */
export function __resetReleasesCache(): void {
  releasesCache = null;
}

/** Catalogue of available ACES releases, marked "installed" / "recommended default". */
export async function listReleases(fetchFn: OutboundFetch = fetchAllowlisted): Promise<OcioReleaseEntry[]> {
  const [releases, installed] = await Promise.all([fetchReleases(fetchFn), readLibrary()]);
  return buildReleaseCatalog(releases, new Set(installed.map((e) => e.assetName)));
}

/** Installed OCIO configs (with a presigned read URL). */
export async function listInstalled(): Promise<(OcioEntry & { url: string })[]> {
  const entries = await readLibrary();
  return Promise.all(
    entries.map(async (e) => ({ ...e, url: await storage.getPresignedGetUrl(e.storageKey) })),
  );
}

/** Default config (the studio's colour fallback), or null if none is installed. */
export async function getDefault(): Promise<OcioEntry | null> {
  const entries = await readLibrary();
  return entries.find((e) => e.isDefault) ?? entries[0] ?? null;
}

/** An installed config by its identifier, or `null` (used by the baking worker). */
export async function getEntry(id: string): Promise<OcioEntry | null> {
  return (await readLibrary()).find((e) => e.id === id) ?? null;
}

// A config's displays/views are immutable once installed → cache keyed by storage key.
const displaysCache = new Map<string, OcioDisplay[]>();

/** Displays/views of an installed config (parses the `.ocio` from MinIO, cached). */
export async function getConfigDisplays(id: string): Promise<OcioDisplay[]> {
  const entries = await readLibrary();
  const entry = entries.find((e) => e.id === id);
  if (!entry) throw notFound('OCIO config not found');
  const cached = displaysCache.get(entry.storageKey);
  if (cached) return cached;
  const stream = await storage.getObjectStream(entry.storageKey);
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  const displays = parseOcioDisplays(Buffer.concat(chunks).toString('utf-8'));
  displaysCache.set(entry.storageKey, displays);
  return displays;
}

/** State of a display LUT for a display/view pair of a config. */
export interface LutInfo {
  display: string;
  view: string;
  size: number;
  /** Presigned URL of the `.cube`, or `null` if no LUT exists (neither baked, nor bakable here). */
  url: string | null;
  /** Why there is none: the view asks for a rendering curve that only OCIO can bake. */
  reason: 'OCIO_TOOLING_REQUIRED' | null;
}

/**
 * Display LUT of a display/view pair. Serves the already baked `.cube`; otherwise, bakes **on demand** the
 * colorimetric fallback (immediate, exact) and asks the worker for the OCIO version
 * of tone-mapped views, which are never produced by approximation.
 *
 * The pair is checked against the config: without this, any authenticated user could have MinIO write a key
 * of their choice.
 */
export async function getLut(configId: string, display: string, view: string): Promise<LutInfo> {
  const displays = await getConfigDisplays(configId);
  if (!isValidDisplayView(displays, display, view))
    throw badRequest('Unknown display/view for this config', 'OCIO_BAD_DISPLAY_VIEW');

  const key = lutStorageKey(configId, display, view);
  const base = { display, view, size: LUT_SIZE };
  try {
    await storage.statObject(key);
    return { ...base, url: await storage.getPresignedGetUrl(key), reason: null };
  } catch {
    // Not yet baked: we try the built-in fallback, otherwise it is the worker's business.
  }

  const lut = bakeBuiltinLut(display, view);
  if (lut) {
    const text = serializeCube(lut, `${display} / ${view}`, BUILTIN_SOURCE);
    await storage.putObject(key, Buffer.from(text, 'utf-8'), 'text/plain; charset=utf-8');
    return { ...base, url: await storage.getPresignedGetUrl(key), reason: null };
  }

  await enqueueOcioBake({ configId, display, view });
  return { ...base, url: null, reason: 'OCIO_TOOLING_REQUIRED' };
}

/**
 * Installs an asset of an ACES release: downloads the `.ocio` (allow-listed host, capped size) and files it
 * in MinIO. The first installed ACES 1.3 studio config becomes the default.
 */
export async function install(
  tag: string,
  assetName: string,
  fetchFn: OutboundFetch = fetchAllowlisted,
): Promise<OcioEntry> {
  const entries = await readLibrary();
  if (entries.some((e) => e.assetName === assetName))
    throw badRequest('This config is already installed', 'OCIO_ALREADY_INSTALLED');

  const catalog = buildReleaseCatalog(await fetchReleases(fetchFn), new Set());
  const release = catalog.find((r) => r.tag === tag);
  const asset = release?.assets.find((a) => a.assetName === assetName);
  if (!asset) throw notFound('ACES config asset not found');
  if (!isAllowedAssetHost(asset.downloadUrl))
    throw badRequest('This download host is not allowed', 'OCIO_BAD_HOST');
  if (asset.sizeBytes > MAX_ASSET_BYTES) throw badRequest('Config is too large', 'OCIO_TOO_LARGE');

  // GitHub serves the asset through a redirect to its content host: we follow it, but each hop goes back
  // through the SSRF guard AND through the allow-list — that is the whole point of
  // `fetchAllowlisted`. A 302 to 169.254.169.254 or minio:9000 is refused before anything is sent.
  const dl = await fetchFn(
    asset.downloadUrl,
    { headers: { 'user-agent': 'ReView-app' } },
    {
      isAllowedHost: (url) => ALLOWED_ASSET_HOSTS.has(url.hostname),
      timeoutMs: OUTBOUND_TIMEOUT_MS,
      maxRedirects: 3,
    },
  );
  if (!dl.ok) throw badRequest(`Download failed (${dl.status})`, 'OCIO_DOWNLOAD_FAILED');
  const buf = await readCappedBody(dl, MAX_ASSET_BYTES, asset.downloadUrl);

  const storageKey = `studio/ocio/${randomUUID()}.ocio`;
  await storage.putObject(storageKey, buf, 'text/plain; charset=utf-8');

  const makeDefault = isDefaultCandidate(asset.info) && !entries.some((e) => e.isDefault);
  const entry: OcioEntry = {
    id: randomUUID(),
    name: asset.label,
    kind: asset.info.kind,
    acesVersion: asset.info.acesVersion,
    ocioVersion: asset.info.ocioVersion,
    configVersion: asset.info.configVersion,
    releaseTag: tag,
    assetName,
    storageKey,
    sizeBytes: buf.byteLength,
    createdAt: new Date().toISOString(),
    isDefault: makeDefault,
  };
  await writeLibrary([...entries, entry]);
  // Display LUTs are baked in the background: the review does not wait for the first read. The queue's
  // failure does not call the installation into question (see enqueueOcioBake).
  await enqueueOcioBake({ configId: entry.id });
  return entry;
}

/** Sets the default config (exclusive). */
export async function setDefault(id: string): Promise<OcioEntry> {
  const entries = await readLibrary();
  if (!entries.some((e) => e.id === id)) throw notFound('OCIO config not found');
  const next = entries.map((e) => ({ ...e, isDefault: e.id === id }));
  await writeLibrary(next);
  return next.find((e) => e.id === id)!;
}

/** Removes an installed config (entry + MinIO object); promotes a default if needed. */
export async function remove(id: string): Promise<void> {
  const entries = await readLibrary();
  const target = entries.find((e) => e.id === id);
  if (!target) throw notFound('OCIO config not found');
  let rest = entries.filter((e) => e.id !== id);
  if (target.isDefault && rest.length > 0 && !rest.some((e) => e.isDefault)) {
    rest = rest.map((e, i) => ({ ...e, isDefault: i === 0 }));
  }
  await writeLibrary(rest);
  await storage.deleteObject(target.storageKey).catch(() => undefined);
  // Baked LUTs no longer have an object: without this purge they would remain orphaned, and a reinstallation
  // of the same config (new id) would never touch them.
  await storage.deletePrefix(lutPrefix(id)).catch(() => undefined);
}
