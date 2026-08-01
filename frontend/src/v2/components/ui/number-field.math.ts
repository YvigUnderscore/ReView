/**
 * Logique pure du champ numérique « drag-label » (`NumberField`) : valeur ajustée en glissant
 * horizontalement sur le libellé (pattern DCC/Blender), bornée et arrondie au pas. Testable
 * sans DOM. Écrite en Phase 17 pour le HUD, promue avec la primitive lors de la refonte du
 * chrome de review — les maths n'ont pas bougé.
 */

export interface NumberFieldSpec {
  min: number;
  max: number;
  /** Pas d'arrondi de la valeur (ex. 1 pour des degrés entiers, 0.001 pour une ouverture). */
  step: number;
  /** Pixels de glissement pour parcourir un pas (défaut 4 — ~250 px pour 60 pas). */
  pixelsPerStep?: number;
}

/** Arrondit `value` au multiple de `step` le plus proche (précision flottante nettoyée). */
export function snapToStep(value: number, step: number): number {
  if (!(step > 0)) return value;
  const snapped = Math.round(value / step) * step;
  // Nettoie le bruit binaire (0.30000000000000004 → 0.3) selon les décimales du pas.
  const decimals = Math.max(0, Math.ceil(-Math.log10(step)));
  return Number(snapped.toFixed(Math.min(decimals + 1, 10)));
}

/** Borne puis arrondit une valeur selon la spec. */
export function clampValue(value: number, spec: NumberFieldSpec): number {
  return Math.min(spec.max, Math.max(spec.min, snapToStep(value, spec.step)));
}

/**
 * Valeur après un glissement de `dxPx` pixels depuis `start` : chaque `pixelsPerStep` pixels
 * vaut un `step` (Maj = ×10 via `fine=false`, Ctrl = pas fin ×0.1 via `fine=true` côté appelant).
 */
export function dragValue(start: number, dxPx: number, spec: NumberFieldSpec, multiplier = 1): number {
  const perStep = spec.pixelsPerStep ?? 4;
  const delta = (dxPx / perStep) * spec.step * multiplier;
  return clampValue(start + delta, spec);
}

/** Parse une saisie clavier (virgule française acceptée) — null si vide ou invalide. */
export function parseInput(text: string): number | null {
  const trimmed = text.trim().replace(',', '.');
  if (trimmed === '') return null;
  const v = Number(trimmed);
  return Number.isFinite(v) ? v : null;
}

/** Formate la valeur pour l'affichage selon le pas (pas de décimales inutiles). */
export function formatValue(value: number, step: number): string {
  const decimals = step >= 1 ? 0 : Math.max(0, Math.ceil(-Math.log10(step)));
  return value.toLocaleString('fr-FR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: Math.min(decimals, 6),
  });
}
