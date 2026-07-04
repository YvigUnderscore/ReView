import type { AssetRef, AssetType, SequenceRef, ShotRef, TaskType } from '../../types/api';

/** Types et constantes partagés des onglets de ProjectPage (découpage 10.C1). */

// Entités API : définitions canoniques dans types/api (10.E2) — ré-exports nommés du domaine projet.
export type {
  Nomenclature,
  Department,
  ProjectSettings,
  Task,
  AssetRef,
  Membership as Member,
  SequenceSummary as Sequence,
  ShotSummary as Shot,
  Asset,
} from '../../types/api';

/** GET /api/sequences/:id — détail d'une séquence (shots + assets liés). */
export type SequenceDetailData = SequenceRef & {
  shots: (ShotRef & { assets: AssetRef[] })[];
  assets: AssetRef[];
};

export const ASSET_TYPES: readonly AssetType[] = [
  'CHARACTER',
  'PROP',
  'ENVIRONMENT',
  'VEHICLE',
  'FX',
  'OTHER',
];
export const TASK_TYPES: readonly TaskType[] = [
  'ANIMATION',
  'FX',
  'COMPOSITING',
  'LIGHTING',
  'MODELING',
  'RIGGING',
  'LOOKDEV',
  'LAYOUT',
  'OTHER',
];

/** Tri par ordre puis par code (numérique : SQ001 < SQ002 < SQ010). */
export function sortByCode<T extends { order: number; code: string }>(items: T[]): T[] {
  return [...items].sort(
    (a, b) => a.order - b.order || a.code.localeCompare(b.code, undefined, { numeric: true }),
  );
}
