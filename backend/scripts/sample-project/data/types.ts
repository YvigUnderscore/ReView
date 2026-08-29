// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { AssetType, ProjectStatus, Role, TaskType } from '@prisma/client';
import type { FILMS } from '../config';
import type { Look } from '../build/video';

/**
 * Description du projet de démonstration.
 *
 * Ces types décrivent **ce que la production raconte**, pas ce que la base contient : un
 * plan déclare où il en est (`stage`), pas la liste de ses versions. C'est le générateur
 * qui déroule la chronologie — tâches, versions, décisions, dates — à partir de cet état.
 * Écrire les deux cents versions à la main aurait produit un jeu figé et incohérent.
 */

export type FilmKey = keyof typeof FILMS;

/** Étape la plus avancée qu'un plan ait atteinte : elle décide de ce qui existe. */
export type Stage = 'briefed' | 'layout' | 'blocking' | 'anim' | 'lookdev' | 'lighting' | 'comp' | 'final';

export interface TeamMember {
  key: string;
  email: string;
  firstName: string;
  lastName: string;
  username: string;
  jobTitle: string;
  bio: string;
  role: Role;
  /** Clés de département (référentiel studio). */
  departments: string[];
  phone?: string;
  /** Compte désactivé : l'accès est coupé, l'historique reste attribué. */
  disabled?: boolean;
  /** Compte de service (ferme de rendu) : aucun login interactif. */
  service?: boolean;
  /** Teinte de l'avatar généré. */
  avatar?: [string, string];
}

/** Livrable d'une version. */
export type MediaSpec =
  | { type: 'clip'; look: Look; at: number; duration?: number; film?: FilmKey; width?: number }
  | { type: 'still'; at: number; look?: Look; film?: FilmKey; extra?: string[] }
  | { type: 'frames'; at: number; count: number; look: Look }
  | { type: 'usdAsset'; asset: string }
  | { type: 'usdShot' }
  | { type: 'glb'; model: 'fox' }
  | { type: 'splat'; scan: string; count?: number };

/** Retour de review écrit à la main sur un plan clé. */
export interface FeedbackSpec {
  /** Clé du membre qui écrit. */
  by: string;
  text: string;
  /** Seconde dans le média (vidéo) — absente pour une image ou un modèle. */
  at?: number;
  /** Plage commentée, en secondes (retour sur une action). */
  range?: [number, number];
  /** Forme d'annotation posée sur l'image. */
  draw?: DrawSpec;
  state?: 'OPEN' | 'WIP' | 'QUESTION' | 'WONT_FIX' | 'RESOLVED';
  /** Visible du client (partage). */
  client?: boolean;
  /** Réponses au fil. */
  replies?: { by: string; text: string; state?: FeedbackSpec['state'] }[];
  /** Réactions emoji, par clé de membre. */
  reactions?: { by: string; emoji: string }[];
  /** Assigné à quelqu'un pour correction. */
  assignee?: string;
  /** Crée une tâche kanban depuis ce retour. */
  spawnTask?: { dept: string; name: string; assignee: string };
}

/** Annotation à dessiner sur la frame commentée. */
export type DrawSpec =
  | { shape: 'circle'; x: number; y: number; r: number; color?: string; label?: string }
  | { shape: 'arrow'; from: [number, number]; to: [number, number]; color?: string; label?: string }
  | { shape: 'box'; x: number; y: number; w: number; h: number; color?: string; label?: string }
  | { shape: 'scribble'; around: [number, number]; color?: string; label?: string };

export interface ShotSpec {
  code: string;
  name: string;
  description: string;
  /** Point d'entrée dans le master du film (secondes). */
  at: number;
  /** Durée du plan (secondes) — décide aussi de l'intervalle d'images. */
  duration?: number;
  film?: FilmKey;
  stage: Stage;
  /** Clés des membres assignés au plan. */
  assignees?: string[];
  /** Brief markdown de la fiche du plan. */
  brief?: string;
  /** Assets utilisés (clés) — alimente la scène USD et les liens. */
  assets?: string[];
  /** Plan coupé au montage : reste en base, sauté par les montages. */
  omitted?: boolean;
  /** Retours écrits à la main, sur la dernière version de l'étape nommée. */
  feedback?: { stage: Stage; notes: FeedbackSpec[] }[];
  /** Livrables supplémentaires (scène USD, séquence d'images…). */
  extraMedia?: { stage: Stage; media: MediaSpec[] }[];
  /** Marqueurs de timeline posés sur la dernière version. */
  markers?: { at: number; name: string; color?: string; by: string }[];
}

export interface SequenceSpec {
  code: string;
  name: string;
  description: string;
  episode?: string;
  brief?: string;
  assignees?: string[];
  shots: ShotSpec[];
}

export interface EpisodeSpec {
  code: string;
  name: string;
  description: string;
  film: FilmKey;
}

export interface AssetSpec {
  key: string;
  name: string;
  type: AssetType;
  typeLabel?: string;
  description: string;
  stage: Stage;
  assignees?: string[];
  brief?: string;
  /** Graphe USD à produire pour cet asset (modèle Poly Haven CC0). */
  usd?: { polyHavenSlug: string; scale?: number; weatheredTint?: [number, number, number, number] };
  /** Splat produit depuis un scan CC0 (asset scanné sur le tournage). */
  splat?: { scan: string; count?: number };
  /** Modèle glTF d'exemple (animation squelettique). */
  glb?: 'fox';
  /** Plaque de référence extraite du film. */
  still?: { at: number; film?: FilmKey; look?: Look };
  feedback?: FeedbackSpec[];
}

export interface PlaylistSpec {
  name: string;
  /** Codes de plans dont la dernière version publiée entre dans la playlist. */
  shots: string[];
  createdBy: string;
}

export interface ShareSpec {
  label: string;
  scope: 'PROJECT' | 'PLAYLIST' | 'VERSION';
  playlist?: string;
  permission: 'VIEW' | 'COMMENT';
  createdBy: string;
  expiresInDays?: number;
  password?: boolean;
  maxViews?: number;
}

export interface ProjectSpec {
  slug: string;
  name: string;
  description: string;
  status: ProjectStatus;
  film: FilmKey;
  /** Résolution de livraison (les films Blender ne sont pas tous en 16/9). */
  resolution: { width: number; height: number };
  framerate: number;
  startFrame: number;
  episodesEnabled?: boolean;
  /** Départements traversés, dans l'ordre du pipe. */
  pipeline: string[];
  /** Membres du projet : clé → rôle projet éventuel. */
  team: { member: string; role?: Role }[];
  /** Convention de nommage des fichiers déposés. */
  naming?: { pattern: string; mode: 'off' | 'warn' | 'reject' };
  brief?: string;
  episodes?: EpisodeSpec[];
  sequences: SequenceSpec[];
  assets: AssetSpec[];
  playlists?: PlaylistSpec[];
  shares?: ShareSpec[];
  /** Quota de stockage du projet, en gigaoctets. */
  storageQuotaGb?: number;
}

/** Type de tâche associé à un département du référentiel studio. */
export const TASK_TYPE_BY_DEPARTMENT: Record<string, TaskType> = {
  LAYOUT: 'LAYOUT',
  MODELING: 'MODELING',
  RIGGING: 'RIGGING',
  LOOKDEV: 'LOOKDEV',
  ANIMATION: 'ANIMATION',
  FX: 'FX',
  LIGHTING: 'LIGHTING',
  COMPOSITING: 'COMPOSITING',
  MATTEPAINT: 'OTHER',
  EDIT: 'OTHER',
};

/** Étape de pipeline atteinte quand un département a livré. */
export const STAGE_ORDER: Stage[] = [
  'briefed',
  'layout',
  'blocking',
  'anim',
  'lookdev',
  'lighting',
  'comp',
  'final',
];

export const stageIndex = (stage: Stage): number => STAGE_ORDER.indexOf(stage);
