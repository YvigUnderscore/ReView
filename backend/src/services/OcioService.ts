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

/**
 * Catalogue des configs couleur OCIO (39.B). Les configs ACES officielles sont récupérées depuis
 * les **releases GitHub de l'ASWF** (`OpenColorIO-Config-ACES`) puis installées dans MinIO
 * (`studio/ocio/`). L'inventaire des configs installées vit dans un `Setting` JSON (`ocioLibrary`)
 * — pas de migration, même pattern que la bibliothèque HDRI. Défaut produit : **ACES 1.3**.
 *
 * Sécurité (CP-SEC) : le dépôt est **fixe** (aucune URL fournie par l'utilisateur) ; on installe
 * uniquement des assets renvoyés par l'API GitHub, dont l'hôte de téléchargement est **allowlisté**,
 * avec un plafond de taille. Les fichiers `.ocio` sont du YAML stocké tel quel (jamais exécuté).
 */

const SETTING_KEY = 'ocioLibrary';
const OCIO_REPO = 'AcademySoftwareFoundation/OpenColorIO-Config-ACES';
const GITHUB_API = 'https://api.github.com';
const ALLOWED_ASSET_HOSTS = new Set([
  'github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
]);
const MAX_ASSET_BYTES = 25 * 1024 * 1024; // 25 Mo (les configs ACES font < 1 Mo)
const RELEASES_TTL_MS = 10 * 60 * 1000;

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

/** Forme (partielle) d'une release GitHub. */
interface GithubRelease {
  tag_name: string;
  name: string | null;
  published_at: string | null;
  assets: { name: string; browser_download_url: string; size: number }[];
}

/** Asset ACES exposé au catalogue admin. */
export interface OcioCatalogAsset {
  assetName: string;
  downloadUrl: string;
  sizeBytes: number;
  info: AcesAssetInfo;
  label: string;
  installed: boolean;
  recommendedDefault: boolean;
}

/** Une release ACES avec ses assets de config reconnus. */
export interface OcioReleaseEntry {
  tag: string;
  name: string;
  publishedAt: string | null;
  assets: OcioCatalogAsset[];
}

/** Construit le catalogue (pur) : ne garde que les releases portant ≥1 asset `.ocio` reconnu. */
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

/** Vrai si l'hôte de l'URL de téléchargement est autorisé (anti-SSRF). */
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

/** Récupère (avec cache 10 min) les releases ACES depuis GitHub. `fetchFn` injectable (tests). */
async function fetchReleases(fetchFn: typeof fetch): Promise<GithubRelease[]> {
  if (releasesCache && Date.now() - releasesCache.at < RELEASES_TTL_MS) return releasesCache.data;
  const res = await fetchFn(`${GITHUB_API}/repos/${OCIO_REPO}/releases?per_page=15`, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'ReView-app' },
  });
  if (!res.ok) throw badRequest(`GitHub answered ${res.status}`, 'OCIO_RELEASES_FAILED');
  const data = (await res.json()) as GithubRelease[];
  releasesCache = { at: Date.now(), data };
  return data;
}

/** Réinitialise le cache des releases (tests). */
export function __resetReleasesCache(): void {
  releasesCache = null;
}

/** Catalogue des releases ACES disponibles, marquées « installées » / « défaut recommandé ». */
export async function listReleases(fetchFn: typeof fetch = fetch): Promise<OcioReleaseEntry[]> {
  const [releases, installed] = await Promise.all([fetchReleases(fetchFn), readLibrary()]);
  return buildReleaseCatalog(releases, new Set(installed.map((e) => e.assetName)));
}

/** Configs OCIO installées (avec URL présignée de lecture). */
export async function listInstalled(): Promise<(OcioEntry & { url: string })[]> {
  const entries = await readLibrary();
  return Promise.all(
    entries.map(async (e) => ({ ...e, url: await storage.getPresignedGetUrl(e.storageKey) })),
  );
}

/** Config par défaut (repli couleur du studio), ou null si aucune installée. */
export async function getDefault(): Promise<OcioEntry | null> {
  const entries = await readLibrary();
  return entries.find((e) => e.isDefault) ?? entries[0] ?? null;
}

/** Une config installée par son identifiant, ou `null` (utilisé par le worker de cuisson). */
export async function getEntry(id: string): Promise<OcioEntry | null> {
  return (await readLibrary()).find((e) => e.id === id) ?? null;
}

// Displays/views d'une config sont immuables une fois installée → cache par clé de stockage.
const displaysCache = new Map<string, OcioDisplay[]>();

/** Displays/views d'une config installée (parse du `.ocio` depuis MinIO, mis en cache). */
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

/** État d'une LUT d'affichage pour un couple display/view d'une config. */
export interface LutInfo {
  display: string;
  view: string;
  size: number;
  /** URL présignée du `.cube`, ou `null` si aucune LUT n'existe (ni cuite, ni cuisinable ici). */
  url: string | null;
  /** Pourquoi il n'y en a pas : la vue demande une courbe de rendu que seul OCIO sait cuire. */
  reason: 'OCIO_TOOLING_REQUIRED' | null;
}

/**
 * LUT d'affichage d'un couple display/view. Sert le `.cube` déjà cuit ; sinon, cuit **à la
 * demande** le repli colorimétrique (immédiat, exact) et demande au worker la version OCIO
 * pour les vues tone-mappées, qu'on ne fabrique jamais par approximation.
 *
 * Le couple est vérifié contre la config : sans cela, n'importe quel authentifié pourrait
 * faire écrire dans MinIO une clé de son choix.
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
    // Pas encore cuite : on tente le repli intégré, sinon c'est l'affaire du worker.
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
 * Installe un asset d'une release ACES : télécharge le `.ocio` (hôte allowlisté, taille plafonnée)
 * et le range dans MinIO. La 1re studio config ACES 1.3 installée devient le défaut.
 */
export async function install(
  tag: string,
  assetName: string,
  fetchFn: typeof fetch = fetch,
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

  const dl = await fetchFn(asset.downloadUrl, { headers: { 'user-agent': 'ReView-app' } });
  if (!dl.ok) throw badRequest(`Download failed (${dl.status})`, 'OCIO_DOWNLOAD_FAILED');
  const buf = Buffer.from(await dl.arrayBuffer());
  if (buf.byteLength > MAX_ASSET_BYTES) throw badRequest('Config is too large', 'OCIO_TOO_LARGE');

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
  // Les LUT d'affichage sont cuites en tâche de fond : la review n'attend pas la première
  // lecture. L'échec de la file ne remet pas l'installation en cause (cf. enqueueOcioBake).
  await enqueueOcioBake({ configId: entry.id });
  return entry;
}

/** Définit la config par défaut (exclusive). */
export async function setDefault(id: string): Promise<OcioEntry> {
  const entries = await readLibrary();
  if (!entries.some((e) => e.id === id)) throw notFound('OCIO config not found');
  const next = entries.map((e) => ({ ...e, isDefault: e.id === id }));
  await writeLibrary(next);
  return next.find((e) => e.id === id)!;
}

/** Supprime une config installée (entrée + objet MinIO) ; promeut un défaut si besoin. */
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
  // Les LUT cuites n'ont plus d'objet : sans cette purge elles resteraient orphelines et
  // une réinstallation de la même config (nouvel id) n'y toucherait jamais.
  await storage.deletePrefix(lutPrefix(id)).catch(() => undefined);
}
