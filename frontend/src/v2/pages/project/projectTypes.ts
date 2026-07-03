import type { Role } from '../../stores/useAuth';

/** Types et constantes partagés des onglets de ProjectPage (découpage 10.C1). */

// Types réglages projet : définition canonique dans ProjectSettingsTab (une entité = une définition).
export type { Nomenclature, Department, ProjectSettings } from '../../components/ProjectSettingsTab';
// Entités API : définition canonique dans lib/queries (10.E1).
export type { SequenceSummary as Sequence, ShotSummary as Shot, AssetSummary as Asset } from '../../lib/queries';

export interface AssetRef { id: number; name: string; type: string }
export interface Task { id: number; name: string; type: string; status: string }
export interface SequenceDetailData {
  id: number; code: string; name: string;
  shots: { id: number; code: string; name: string; assets: AssetRef[] }[];
  assets: AssetRef[];
}
export interface Member { id: number; role: Role | null; user: { id: number; name: string | null; email: string; role: Role } }

export const ASSET_TYPES = ['CHARACTER', 'PROP', 'ENVIRONMENT', 'VEHICLE', 'FX', 'OTHER'];
export const TASK_TYPES = ['ANIMATION', 'FX', 'COMPOSITING', 'LIGHTING', 'MODELING', 'RIGGING', 'LOOKDEV', 'LAYOUT', 'OTHER'];

/** Tri par ordre puis par code (numérique : SQ001 < SQ002 < SQ010). */
export function sortByCode<T extends { order: number; code: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.order - b.order || a.code.localeCompare(b.code, undefined, { numeric: true }));
}
