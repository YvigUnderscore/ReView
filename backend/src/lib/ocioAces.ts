// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Analyse des configs OCIO ACES publiées par l'ASWF (39.B) — dépôt
 * `AcademySoftwareFoundation/OpenColorIO-Config-ACES`. Les assets de release nomment le type de
 * config et les versions, ex. `studio-config-v2.1.0_aces-v1.3_ocio-v2.3.ocio`. Module **pur**
 * (aucun I/O) : parsing des noms d'assets + choix de la config recommandée par défaut.
 */

export type AcesConfigKind = 'studio' | 'cg';

/** Version ACES retenue par défaut (demande produit). */
export const DEFAULT_ACES_VERSION = '1.3';

export interface AcesAssetInfo {
  kind: AcesConfigKind;
  /** Version de la config (ex. `2.1.0`). */
  configVersion: string;
  /** Version ACES (ex. `1.3`). */
  acesVersion: string;
  /** Version OCIO ciblée (ex. `2.3`). */
  ocioVersion: string;
  /** Nom d'asset d'origine (`…​.ocio`). */
  assetName: string;
}

const ASSET_RE = /^(studio-config|cg-config)-v(\d+\.\d+\.\d+)_aces-v(\d+\.\d+)_ocio-v(\d+\.\d+)\.ocio$/;

/** Parse un nom d'asset de release ACES ; renvoie `null` si le nom ne correspond pas. */
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

/** Libellé lisible d'une config (ex. « Studio config — ACES 1.3 (config v2.1.0, OCIO 2.3) »). */
export function acesDisplayName(info: AcesAssetInfo): string {
  const kind = info.kind === 'studio' ? 'Studio config' : 'CG config';
  return `${kind} — ACES ${info.acesVersion} (config v${info.configVersion}, OCIO ${info.ocioVersion})`;
}

/** Compare deux versions pointées (`2.1.0` vs `2.10.0`) numériquement. >0 si `a`>`b`. */
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
 * Config recommandée par défaut parmi une liste d'assets : la **studio config ACES 1.3** de plus
 * haute version. À défaut, la studio config d'ACES le plus récent ; sinon le premier asset connu.
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

/** Vrai si l'asset est la config à proposer par défaut (studio ACES 1.3). */
export function isDefaultCandidate(info: AcesAssetInfo): boolean {
  return info.kind === 'studio' && info.acesVersion === DEFAULT_ACES_VERSION;
}
