// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Parsing of the OCIO ACES configs published by the ASWF (39.B) — repository `AcademySoftwareFoundation/OpenColorIO-Config-ACES`.
 * Release assets name the config type and the versions, e.g. `studio-config-v2.1.0_aces-v1.3_ocio-v2.3.ocio`. **Pure**
 * module (no I/O): parsing of the asset names + choice of the recommended config by default.
 */

export type AcesConfigKind = 'studio' | 'cg';

/** ACES version selected by default (product request). */
export const DEFAULT_ACES_VERSION = '1.3';

export interface AcesAssetInfo {
  kind: AcesConfigKind;
  /** Config version (e.g. `2.1.0`). */
  configVersion: string;
  /** ACES version (e.g. `1.3`). */
  acesVersion: string;
  /** Targeted OCIO version (e.g. `2.3`). */
  ocioVersion: string;
  /** Original asset name (`… .ocio`). */
  assetName: string;
}

const ASSET_RE = /^(studio-config|cg-config)-v(\d+\.\d+\.\d+)_aces-v(\d+\.\d+)_ocio-v(\d+\.\d+)\.ocio$/;

/** Parses an ACES release asset name; returns `null` if the name does not match. */
export function parseAcesAsset(name: string): AcesAssetInfo | null {
  const trimmed = name.trim();
  const m = ASSET_RE.exec(trimmed);
  if (!m) return null;
  const [, kindRaw, configVersion, acesVersion, ocioVersion] = m;
  if (!kindRaw || !configVersion || !acesVersion || !ocioVersion) return null;
  return {
    kind: kindRaw === 'studio-config' ? 'studio' : 'cg',
    configVersion,
    acesVersion,
    ocioVersion,
    assetName: trimmed,
  };
}

/** Readable label of a config (e.g. "Studio config — ACES 1.3 (config v2.1.0, OCIO 2.3)"). */
export function acesDisplayName(info: AcesAssetInfo): string {
  const kind = info.kind === 'studio' ? 'Studio config' : 'CG config';
  return `${kind} — ACES ${info.acesVersion} (config v${info.configVersion}, OCIO ${info.ocioVersion})`;
}

/** Compares two dotted versions (`2.1.0` vs `2.10.0`) numerically. >0 if `a` > `b`. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * Default recommended config among a list of assets: the **ACES 1.3 studio config** of the highest version.
 * Failing that, the studio config of the most recent ACES; otherwise the first known asset.
 */
export function pickRecommended(infos: AcesAssetInfo[]): AcesAssetInfo | null {
  if (infos.length === 0) return null;
  const studios = infos.filter((i) => i.kind === 'studio');
  const byConfigDesc = (a: AcesAssetInfo, b: AcesAssetInfo) =>
    compareVersions(b.configVersion, a.configVersion);

  const default13 = studios.filter((i) => i.acesVersion === DEFAULT_ACES_VERSION).sort(byConfigDesc);
  if (default13[0]) return default13[0];

  const latestStudio = [...studios].sort(
    (a, b) => compareVersions(b.acesVersion, a.acesVersion) || byConfigDesc(a, b),
  );
  return latestStudio[0] ?? infos[0] ?? null;
}

/** True if the asset is the config to offer by default (ACES 1.3 studio). */
export function isDefaultCandidate(info: AcesAssetInfo): boolean {
  return info.kind === 'studio' && info.acesVersion === DEFAULT_ACES_VERSION;
}
