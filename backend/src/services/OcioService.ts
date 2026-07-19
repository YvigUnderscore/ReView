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
  if (!res.ok) throw badRequest(`GitHub a répondu ${res.status}`, 'OCIO_RELEASES_FAILED');
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
    throw badRequest('Cette config est déjà installée', 'OCIO_ALREADY_INSTALLED');

  const catalog = buildReleaseCatalog(await fetchReleases(fetchFn), new Set());
  const release = catalog.find((r) => r.tag === tag);
  const asset = release?.assets.find((a) => a.assetName === assetName);
  if (!asset) throw notFound('Asset de config ACES introuvable');
  if (!isAllowedAssetHost(asset.downloadUrl))
    throw badRequest('Hôte de téléchargement non autorisé', 'OCIO_BAD_HOST');
  if (asset.sizeBytes > MAX_ASSET_BYTES) throw badRequest('Config trop volumineuse', 'OCIO_TOO_LARGE');

  const dl = await fetchFn(asset.downloadUrl, { headers: { 'user-agent': 'ReView-app' } });
  if (!dl.ok) throw badRequest(`Téléchargement échoué (${dl.status})`, 'OCIO_DOWNLOAD_FAILED');
  const buf = Buffer.from(await dl.arrayBuffer());
  if (buf.byteLength > MAX_ASSET_BYTES) throw badRequest('Config trop volumineuse', 'OCIO_TOO_LARGE');

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
  return entry;
}

/** Définit la config par défaut (exclusive). */
export async function setDefault(id: string): Promise<OcioEntry> {
  const entries = await readLibrary();
  if (!entries.some((e) => e.id === id)) throw notFound('Config OCIO introuvable');
  const next = entries.map((e) => ({ ...e, isDefault: e.id === id }));
  await writeLibrary(next);
  return next.find((e) => e.id === id)!;
}

/** Supprime une config installée (entrée + objet MinIO) ; promeut un défaut si besoin. */
export async function remove(id: string): Promise<void> {
  const entries = await readLibrary();
  const target = entries.find((e) => e.id === id);
  if (!target) throw notFound('Config OCIO introuvable');
  let rest = entries.filter((e) => e.id !== id);
  if (target.isDefault && rest.length > 0 && !rest.some((e) => e.isDefault)) {
    rest = rest.map((e, i) => ({ ...e, isDefault: i === 0 }));
  }
  await writeLibrary(rest);
  await storage.deleteObject(target.storageKey).catch(() => undefined);
}
