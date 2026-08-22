// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Réglages de la transformée d'affichage — **préférence de lecture**, jamais une modification
 * du média : rien n'est renvoyé au serveur, rien n'est écrit sur le fichier. C'est le contrat
 * du produit (le verrou de publication interdit de toucher un média publié) et le panneau le
 * dit à l'écran.
 *
 * Module **pur** : bornes, valeurs par défaut, résolution du couple display/view effectif et
 * (dé)sérialisation. L'état vivant est dans `useColorGrade.ts`.
 */

export interface ColorSettings {
  /** Transformée d'affichage appliquée aux pixels (bascule de comparaison avant/après). */
  enabled: boolean;
  /** Display choisi par le lecteur ; `null` = celui de la configuration du projet. */
  display: string | null;
  view: string | null;
  /** Exposition en diaphragmes, appliquée en linéaire avant la transformée. */
  exposure: number;
  /** Gamma d'affichage appliqué **après** la transformée (lecture des basses lumières). */
  gamma: number;
}

export const EXPOSURE_RANGE = { min: -6, max: 6, step: 0.05 } as const;
export const GAMMA_RANGE = { min: 0.2, max: 4, step: 0.01 } as const;

export const DEFAULT_COLOR_SETTINGS: ColorSettings = {
  enabled: true,
  display: null,
  view: null,
  exposure: 0,
  gamma: 1,
};

const clampNumber = (v: unknown, min: number, max: number, fallback: number): number => {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
};

const cleanName = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() && v.length <= 160 ? v : null;

/** Ramène n'importe quelle entrée (stockage, URL, API) à des réglages valides. */
export function clampSettings(input: Partial<ColorSettings> | null | undefined): ColorSettings {
  const s = input ?? {};
  return {
    enabled: s.enabled !== false,
    display: cleanName(s.display),
    view: cleanName(s.view),
    exposure: clampNumber(s.exposure, EXPOSURE_RANGE.min, EXPOSURE_RANGE.max, 0),
    gamma: clampNumber(s.gamma, GAMMA_RANGE.min, GAMMA_RANGE.max, 1),
  };
}

/** Vrai si les réglages ne changent rien à l'image (bouton « retour à zéro » sans effet). */
export function isNeutral(s: ColorSettings): boolean {
  return s.exposure === 0 && s.gamma === 1 && s.display === null && s.view === null && s.enabled;
}

/** Configuration couleur héritée du projet, telle que la sert `GET /api/media/:id`. */
export interface ProjectColor {
  configId?: string;
  display?: string;
  view?: string;
}

export interface ResolvedDisplayView {
  configId: string;
  display: string;
  view: string;
  /** Le couple vient du choix du lecteur plutôt que du projet. */
  overridden: boolean;
}

/**
 * Couple display/view effectivement demandé au serveur. Le choix du lecteur ne l'emporte que
 * s'il existe **dans la config du projet** : une préférence gardée d'un autre projet ne doit
 * pas faire cuire une LUT qui n'a pas de sens ici.
 */
export function resolveDisplayView(
  settings: ColorSettings,
  project: ProjectColor | null | undefined,
  displays: { name: string; views: string[] }[] = [],
): ResolvedDisplayView | null {
  const configId = project?.configId;
  if (!configId) return null;
  const known = (d: string | null, v: string | null): boolean =>
    !!d && !!v && displays.some((x) => x.name === d && x.views.includes(v));

  if (known(settings.display, settings.view))
    return { configId, display: settings.display!, view: settings.view!, overridden: true };

  const display = project?.display;
  const view = project?.view;
  if (!display || !view) return null;
  // Tant que la liste n'est pas chargée on fait confiance au projet ; une fois chargée, un
  // couple absent de la config (config remplacée) ne vaut plus rien.
  if (displays.length > 0 && !known(display, view)) return null;
  return { configId, display, view, overridden: false };
}

const STORAGE_KEY = 'review:color';

/** Relit les réglages persistés (jamais d'exception : une préférence corrompue est ignorée). */
export function readStoredSettings(storage: Pick<Storage, 'getItem'> = localStorage): ColorSettings {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    return clampSettings(raw ? (JSON.parse(raw) as Partial<ColorSettings>) : null);
  } catch {
    return { ...DEFAULT_COLOR_SETTINGS };
  }
}

/** Persiste les réglages (préférence locale au navigateur, comme les guides de composition). */
export function writeStoredSettings(
  s: ColorSettings,
  storage: Pick<Storage, 'setItem'> = localStorage,
): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // Mode privé / quota plein : la préférence ne survit pas à la session, sans conséquence.
  }
}
