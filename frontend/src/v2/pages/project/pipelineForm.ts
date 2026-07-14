import type { PipelineOverride, PipelineSettings } from '../../types/api';

/** État de formulaire d'un override pipeline (chaînes éditables + bascule hériter/personnaliser). */
export interface PipelineForm {
  custom: boolean;
  width: string;
  height: string;
  framerate: string;
}

/** Applique un override partiel sur un socle pipeline (miroir client du backend). */
export function applyOverride(base: PipelineSettings, o: PipelineOverride | undefined): PipelineSettings {
  if (!o) return base;
  return {
    resolution: o.resolution ?? base.resolution,
    framerate: o.framerate ?? base.framerate,
  };
}

function toInt(v: string, fallback: number): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
function toNum(v: string, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Construit l'état de formulaire depuis un override existant + les valeurs héritées.
 * Les champs sont préremplis avec l'override si présent, sinon la valeur héritée du parent.
 */
export function formFromOverride(o: PipelineOverride | undefined, inherited: PipelineSettings): PipelineForm {
  const custom = !!(o && (o.resolution || o.framerate !== undefined));
  return {
    custom,
    width: String(o?.resolution?.width ?? inherited.resolution.width),
    height: String(o?.resolution?.height ?? inherited.resolution.height),
    framerate: String(o?.framerate ?? inherited.framerate),
  };
}

/**
 * Override à envoyer au backend : `{}` (hérite) si non personnalisé, sinon la résolution
 * et la cadence saisies (repli sur l'hérité si la saisie est vide ou invalide).
 */
export function overrideFromForm(f: PipelineForm, inherited: PipelineSettings): PipelineOverride {
  if (!f.custom) return {};
  return {
    resolution: {
      width: toInt(f.width, inherited.resolution.width),
      height: toInt(f.height, inherited.resolution.height),
    },
    framerate: toNum(f.framerate, inherited.framerate),
  };
}
