// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { TaskType, VersionStatus } from '@prisma/client';
import type { Look } from './build/video';
import { DECISION_NOTES, NOTES_BY_DEPARTMENT, REPLIES } from './data/feedback';
import type {
  AssetSpec,
  FeedbackSpec,
  MediaSpec,
  ProjectSpec,
  SequenceSpec,
  ShotSpec,
  Stage,
} from './data/types';
import { TASK_TYPE_BY_DEPARTMENT, stageIndex } from './data/types';
import { makeRng, type Rng } from './lib/rng';

/**
 * Déroulé de la production.
 *
 * Les fichiers de projet décrivent **un état** : ce plan en est à l'animation, cet asset est
 * publié. Ce module en déduit l'histoire — qui a livré quoi, quand, ce qui a été refusé et
 * repris — parce que c'est cette histoire qui fait vivre l'application : sans versions
 * successives ni décisions datées, un jeu de données reste une maquette.
 *
 * Tout est déterministe (`lib/rng`) : deux exécutions produisent le même projet.
 */

/** Début de production : tout est daté relativement à ce point. */
export const PRODUCTION_DAYS = 130;

/** Départements qui travaillent sur un plan (les autres portent des tâches d'asset). */
const SHOT_DEPARTMENTS = ['LAYOUT', 'ANIMATION', 'FX', 'LIGHTING', 'MATTEPAINT', 'COMPOSITING'];

/** Départements qui travaillent sur un asset. */
const ASSET_DEPARTMENTS = ['MODELING', 'RIGGING', 'LOOKDEV', 'FX'];

/** Fenêtre de travail d'un département, en jours depuis le début de production. */
const DEPARTMENT_WINDOW: Record<string, [number, number]> = {
  EDIT: [0, 20],
  LAYOUT: [4, 38],
  MODELING: [0, 45],
  RIGGING: [12, 60],
  LOOKDEV: [24, 72],
  ANIMATION: [30, 88],
  FX: [52, 104],
  LIGHTING: [66, 116],
  MATTEPAINT: [60, 100],
  COMPOSITING: [86, 128],
};

/** Département dont l'achèvement définit chaque étape. */
const STAGE_DEPARTMENT: Record<Stage, string | null> = {
  briefed: null,
  layout: 'LAYOUT',
  // Le lookdev est une etape d'asset : aucun plan ne s'y arrete.
  lookdev: null,
  blocking: 'ANIMATION',
  anim: 'ANIMATION',
  lighting: 'LIGHTING',
  comp: 'COMPOSITING',
  final: 'COMPOSITING',
};

/** Étapes où le département courant est encore en cours (et non livré). */
const IN_PROGRESS_STAGES: Stage[] = ['blocking', 'lighting', 'comp'];

/** Rendu imité par le playblast d'un département. */
function lookFor(department: string, versionIndex: number, stage: Stage): Look {
  switch (department) {
    case 'LAYOUT':
      return 'layout';
    case 'ANIMATION':
      return versionIndex === 0 && stage === 'blocking'
        ? 'blocking'
        : versionIndex === 0
          ? 'blocking'
          : 'anim';
    case 'FX':
      return 'anim';
    case 'LIGHTING':
      return 'lighting';
    case 'MATTEPAINT':
      return 'plate';
    case 'COMPOSITING':
    default:
      return 'comp';
  }
}

/** Statuts du vocabulaire de pipeline utilisés par le générateur. */
export const STATUS = {
  waiting: 'wtg',
  ready: 'rdy',
  inProgress: 'ip',
  review: 'rev',
  retake: 'rtk',
  final: 'fin',
  omitted: 'omt',
  hold: 'hld',
} as const;

export interface PlannedComment {
  authorKey: string;
  text: string;
  createdAt: Date;
  timestamp?: number;
  duration?: number;
  annotation?: unknown;
  state: 'OPEN' | 'WIP' | 'QUESTION' | 'WONT_FIX' | 'RESOLVED';
  visibleToClient: boolean;
  assigneeKey?: string;
  resolvedByKey?: string;
  replies: { authorKey: string; text: string; createdAt: Date }[];
  reactions: { authorKey: string; emoji: string }[];
  spawnTask?: { dept: string; name: string; assigneeKey: string };
}

export interface PlannedMedia {
  spec: MediaSpec;
  /** Nom de fichier livré, tel qu'il apparaît dans la review. */
  filename: string;
  kind: 'VIDEO' | 'IMAGE' | 'MODEL_3D' | 'SPLAT';
}

export interface PlannedVersion {
  name: string;
  department: string;
  authorKey: string;
  createdAt: Date;
  status: VersionStatus;
  published: boolean;
  media: PlannedMedia[];
  decision?: { status: string; byKey: string; note: string; at: Date };
  comments: PlannedComment[];
  markers: { frame: number; name: string; color: string; byKey: string }[];
}

export interface PlannedTask {
  department: string;
  name: string;
  type: TaskType;
  assigneeKey: string;
  statusCode: string;
  startDate: Date;
  dueDate: Date;
  checklist: { text: string; done: boolean }[];
  versions: PlannedVersion[];
}

export interface PlannedShot {
  spec: ShotSpec;
  sequence: SequenceSpec;
  statusCode: string;
  tasks: PlannedTask[];
}

export interface PlannedAsset {
  spec: AssetSpec;
  statusCode: string;
  tasks: PlannedTask[];
}

export interface PlannedProject {
  spec: ProjectSpec;
  shots: PlannedShot[];
  assets: PlannedAsset[];
}

/**
 * Échéance d'une tâche.
 *
 * Une tâche livrée a une échéance passée — c'est normal, elle est finie. Une tâche encore
 * ouverte doit en avoir une **à venir**, sinon tout le planning s'affiche en retard et les
 * écrans de production ne montrent plus rien d'utile. Une poignée de tâches restent en
 * retard, parce qu'un studio en a toujours.
 */
function taskDue(done: boolean, windowEnd: number, rng: Rng): Date {
  if (done) return dayOffset(Math.min(windowEnd, PRODUCTION_DAYS - 2));
  const late = rng.chance(0.12);
  const days = late ? -rng.int(2, 9) : rng.int(3, 28);
  return new Date(Date.now() + days * 86400000);
}

/** Date située à `days` jours après le début de production. */
export function dayOffset(days: number, hour = 10): Date {
  const now = Date.now();
  const start = now - PRODUCTION_DAYS * 86400000;
  const date = new Date(start + days * 86400000);
  date.setHours(hour, (days * 17) % 60, 0, 0);
  return date > new Date(now) ? new Date(now - 3600000) : date;
}

/** Numéro de version formaté (`v003`). */
const versionName = (index: number): string => `v${String(index + 1).padStart(3, '0')}`;

/** Qui livre pour ce département sur ce plan : l'assigné s'il est du métier, sinon un membre. */
function pickAuthor(spec: ShotSpec | AssetSpec, members: string[], rng: Rng): string {
  const assignees = spec.assignees ?? [];
  const candidates = assignees.filter((key) => members.includes(key));
  return candidates.length > 0 ? rng.pick(candidates) : rng.pick(members);
}

/** Annotation dessinée : une forme, posée là où le retour désigne quelque chose. */
function makeAnnotation(rng: Rng, kind: 'circle' | 'arrow' | 'box'): unknown[] {
  const color = rng.pick(['#ff5c5c', '#ffd166', '#4cc9f0', '#7bdc6a']);
  const id = `s${rng.int(1000, 9999)}`;
  if (kind === 'circle') {
    const cx = 0.3 + rng.next() * 0.4;
    const cy = 0.3 + rng.next() * 0.35;
    return [
      {
        id,
        type: 'ellipse',
        color,
        width: 3,
        cx,
        cy,
        rx: 0.06 + rng.next() * 0.05,
        ry: 0.08 + rng.next() * 0.05,
      },
    ];
  }
  if (kind === 'arrow') {
    const x2 = 0.35 + rng.next() * 0.35;
    const y2 = 0.3 + rng.next() * 0.3;
    return [{ id, type: 'arrow', color, width: 3, x1: x2 + 0.18, y1: y2 + 0.22, x2, y2 }];
  }
  const x = 0.15 + rng.next() * 0.3;
  const y = 0.2 + rng.next() * 0.3;
  return [
    { id, type: 'rect', color, width: 3, x, y, w: 0.2 + rng.next() * 0.25, h: 0.15 + rng.next() * 0.2 },
  ];
}

/** Traduit une annotation écrite à la main en formes normalisées (0..1). */
export function drawSpecToShapes(draw: NonNullable<FeedbackSpec['draw']>): unknown[] {
  const color = draw.color ?? '#ff5c5c';
  const base = { id: `h${Math.abs(hashOf(JSON.stringify(draw))) % 9999}`, color, width: 3 };
  const label = (x: number, y: number): unknown[] =>
    draw.label ? [{ ...base, id: `${base.id}t`, type: 'text', x, y, text: draw.label, width: 4 }] : [];
  switch (draw.shape) {
    case 'circle':
      return [
        { ...base, type: 'ellipse', cx: draw.x, cy: draw.y, rx: draw.r, ry: draw.r * 1.15 },
        ...label(draw.x - draw.r, draw.y - draw.r - 0.03),
      ];
    case 'arrow':
      return [
        { ...base, type: 'arrow', x1: draw.from[0], y1: draw.from[1], x2: draw.to[0], y2: draw.to[1] },
        ...label(draw.from[0], draw.from[1] + 0.04),
      ];
    case 'box':
      return [
        { ...base, type: 'rect', x: draw.x, y: draw.y, w: draw.w, h: draw.h },
        ...label(draw.x, draw.y - 0.02),
      ];
    case 'scribble':
    default: {
      const [cx, cy] = draw.around;
      const pts = Array.from({ length: 14 }, (_, i) => {
        const angle = (i / 14) * Math.PI * 4;
        const radius = 0.05 + (i % 3) * 0.012;
        return [cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius * 1.2];
      });
      return [{ ...base, type: 'path', pts }, ...label(cx - 0.06, cy - 0.09)];
    }
  }
}

function hashOf(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) | 0;
  return hash;
}

/** Fil de commentaires généré pour une version livrée. */
function generateComments(
  department: string,
  version: { createdAt: Date; duration: number },
  reviewers: string[],
  team: string[],
  rng: Rng,
): PlannedComment[] {
  const bank = NOTES_BY_DEPARTMENT[department] ?? [];
  if (bank.length === 0 || reviewers.length === 0) return [];
  const count = rng.int(1, 3);
  return rng.sample(bank, count).map((note, index) => {
    const authorKey = rng.pick(reviewers);
    const createdAt = new Date(version.createdAt.getTime() + (index + 1) * rng.int(20, 300) * 60000);
    const marks = note.marks === true;
    const ranged = note.ranged === true;
    const timestamp = Number((rng.next() * Math.max(version.duration - 0.5, 0.5)).toFixed(2));
    const replyCount = rng.chance(0.55) ? rng.int(1, 2) : 0;
    return {
      authorKey,
      text: note.text,
      createdAt,
      ...(marks || ranged ? { timestamp } : {}),
      ...(ranged ? { duration: Number((0.3 + rng.next() * 0.9).toFixed(2)) } : {}),
      ...(marks ? { annotation: makeAnnotation(rng, rng.pick(['circle', 'arrow', 'box'] as const)) } : {}),
      state: note.state ?? (rng.chance(0.35) ? 'RESOLVED' : rng.chance(0.2) ? 'WIP' : 'OPEN'),
      visibleToClient: rng.chance(0.15),
      ...(rng.chance(0.3) ? { assigneeKey: rng.pick(team) } : {}),
      replies: Array.from({ length: replyCount }, (_, i) => ({
        authorKey: rng.pick(team.filter((k) => k !== authorKey)),
        text: rng.pick(REPLIES),
        createdAt: new Date(createdAt.getTime() + (i + 1) * rng.int(30, 400) * 60000),
      })),
      reactions: rng.chance(0.4)
        ? [{ authorKey: rng.pick(team), emoji: rng.pick(['👍', '🔥', '👀', '🙏', '❤️']) }]
        : [],
    };
  });
}

/** Retour écrit à la main : converti tel quel, sans tirage aléatoire. */
function convertFeedback(note: FeedbackSpec, createdAt: Date, rng: Rng): PlannedComment {
  const annotation: unknown[] = [];
  if (note.draw) annotation.push(...drawSpecToShapes(note.draw));
  if (note.range) {
    annotation.push({
      type: 'range',
      inFrame: Math.round(note.range[0] * 24),
      outFrame: Math.round(note.range[1] * 24),
    });
  }
  return {
    authorKey: note.by,
    text: note.text,
    createdAt,
    ...(note.at !== undefined ? { timestamp: note.at } : {}),
    ...(note.range ? { duration: Number((note.range[1] - note.range[0]).toFixed(2)) } : {}),
    ...(annotation.length > 0 ? { annotation } : {}),
    state: note.state ?? 'OPEN',
    visibleToClient: note.client === true,
    ...(note.assignee ? { assigneeKey: note.assignee } : {}),
    replies: (note.replies ?? []).map((reply, index) => ({
      authorKey: reply.by,
      text: reply.text,
      createdAt: new Date(createdAt.getTime() + (index + 1) * rng.int(45, 600) * 60000),
    })),
    reactions: (note.reactions ?? []).map((r) => ({ authorKey: r.by, emoji: r.emoji })),
    ...(note.spawnTask
      ? {
          spawnTask: {
            dept: note.spawnTask.dept,
            name: note.spawnTask.name,
            assigneeKey: note.spawnTask.assignee,
          },
        }
      : {}),
  };
}

/** Livrable par défaut d'une version, selon le département. */
function defaultMedia(shot: ShotSpec, department: string, look: Look): MediaSpec {
  if (department === 'MATTEPAINT') return { type: 'still', at: shot.at, look: 'plate' };
  return { type: 'clip', look, at: shot.at, duration: shot.duration ?? 5 };
}

/** Nom du fichier livré — celui qui s'affichera dans la review. */
function mediaFilename(code: string, department: string, version: string, media: MediaSpec): string {
  const dept = department.toLowerCase();
  switch (media.type) {
    case 'clip':
      return `${code}_${dept}_${version}.mp4`;
    case 'still':
      return `${code}_${dept}_${version}.png`;
    case 'frames':
      return `${code}_${dept}_${version}.%04d.png`;
    case 'usdAsset':
    case 'usdShot':
      return `${code}_${dept}_${version}.zip`;
    case 'glb':
      return `${code}_${dept}_${version}.glb`;
    case 'splat':
    default:
      return `${code}_${dept}_${version}.ply`;
  }
}

const KIND_BY_MEDIA: Record<MediaSpec['type'], PlannedMedia['kind']> = {
  clip: 'VIDEO',
  still: 'IMAGE',
  frames: 'VIDEO',
  usdAsset: 'MODEL_3D',
  usdShot: 'MODEL_3D',
  glb: 'MODEL_3D',
  splat: 'SPLAT',
};

export function toPlannedMedia(
  code: string,
  department: string,
  version: string,
  spec: MediaSpec,
): PlannedMedia {
  return { spec, filename: mediaFilename(code, department, version, spec), kind: KIND_BY_MEDIA[spec.type] };
}

/** Superviseurs habilités à poser une décision sur ce département. */
function reviewersFor(
  department: string,
  project: ProjectSpec,
  memberDepartments: Map<string, string[]>,
): string[] {
  const supervisors = project.team
    .map((t) => t.member)
    .filter((key) => {
      const departments = memberDepartments.get(key) ?? [];
      return departments.includes(department);
    });
  return supervisors.length > 0 ? supervisors : project.team.map((t) => t.member).slice(0, 3);
}

interface BuildContext {
  project: ProjectSpec;
  /** Membres du projet capables de livrer, par département. */
  workersByDepartment: Map<string, string[]>;
  /** Superviseurs par département (pour les décisions). */
  reviewersByDepartment: Map<string, string[]>;
  team: string[];
}

/** Tâches et versions d'un plan, déroulées jusqu'à son étape. */
function buildShotTasks(shot: ShotSpec, context: BuildContext, rng: Rng): PlannedTask[] {
  const departments = context.project.pipeline.filter((d) => SHOT_DEPARTMENTS.includes(d));
  const targetDepartment = STAGE_DEPARTMENT[shot.stage];
  const targetIndex = targetDepartment ? departments.indexOf(targetDepartment) : -1;
  const currentInProgress = IN_PROGRESS_STAGES.includes(shot.stage);
  const manual = new Map((shot.feedback ?? []).map((f) => [f.stage, f.notes]));
  const extras = new Map((shot.extraMedia ?? []).map((e) => [e.stage, e.media]));

  const tasks: PlannedTask[] = [];
  for (const [index, department] of departments.entries()) {
    // FX ne concerne pas tous les plans : sans travail d'effets, la tâche n'existe pas.
    if (department === 'FX' && !rng.chance(0.42)) continue;
    if (department === 'MATTEPAINT' && !rng.chance(0.3)) continue;
    const beyond = targetIndex < 0 || index > targetIndex;
    const isCurrent = index === targetIndex;
    const done = !beyond && (!isCurrent || !currentInProgress);

    const [windowStart, windowEnd] = DEPARTMENT_WINDOW[department] ?? [0, 120];
    const workers = context.workersByDepartment.get(department) ?? context.team;
    const assigneeKey = pickAuthor(shot, workers, rng);
    const statusCode = beyond
      ? index === targetIndex + 1
        ? STATUS.ready
        : STATUS.waiting
      : done
        ? STATUS.final
        : rng.chance(0.4)
          ? STATUS.review
          : STATUS.inProgress;

    const task: PlannedTask = {
      department,
      name: department.toLowerCase(),
      type: TASK_TYPE_BY_DEPARTMENT[department] ?? 'OTHER',
      assigneeKey,
      statusCode: shot.omitted === true ? STATUS.omitted : statusCode,
      startDate: dayOffset(windowStart),
      dueDate: taskDue(done, windowEnd, rng),
      checklist: checklistFor(department, done),
      versions: [],
    };

    if (!beyond) {
      const versionCount = done ? rng.int(2, 3) : rng.int(1, 3);
      for (let v = 0; v < versionCount; v += 1) {
        const last = v === versionCount - 1;
        const progress = versionCount === 1 ? 1 : v / (versionCount - 1);
        const createdAt = dayOffset(windowStart + (windowEnd - windowStart) * (0.25 + progress * 0.7), 9 + v);
        const look = lookFor(department, v, shot.stage);
        const media: MediaSpec[] = [defaultMedia(shot, department, look)];
        const stageOfDepartment = stageForDepartment(department, shot.stage);
        if (last && extras.has(stageOfDepartment)) media.push(...extras.get(stageOfDepartment)!);

        const published = done && last;
        const reviewers = context.reviewersByDepartment.get(department) ?? context.team;
        const decisionStatus =
          done && last ? 'Approved' : !last ? (rng.chance(0.6) ? 'Retake' : 'CBB') : 'Pending';
        const comments: PlannedComment[] = [];
        if (last && manual.has(stageOfDepartment)) {
          for (const note of manual.get(stageOfDepartment)!) {
            comments.push(convertFeedback(note, new Date(createdAt.getTime() + 3600000), rng));
          }
        }
        comments.push(
          ...generateComments(
            department,
            { createdAt, duration: shot.duration ?? 5 },
            reviewers,
            context.team,
            rng,
          ),
        );

        task.versions.push({
          name: versionName(v),
          department,
          authorKey: assigneeKey,
          createdAt,
          status: published ? 'PUBLISHED' : last ? 'REVIEW' : 'PUBLISHED',
          published: published || !last,
          media: media.map((m) => toPlannedMedia(shot.code, department, versionName(v), m)),
          decision: {
            status: decisionStatus,
            byKey: rng.pick(reviewers),
            note: rng.pick(DECISION_NOTES[decisionStatus] ?? DECISION_NOTES.Pending!),
            at: new Date(createdAt.getTime() + rng.int(4, 40) * 3600000),
          },
          comments,
          markers:
            last && shot.markers
              ? shot.markers.map((m) => ({
                  frame: Math.round(m.at * (context.project.framerate || 24)),
                  name: m.name,
                  color: m.color ?? '#22d3ee',
                  byKey: m.by,
                }))
              : [],
        });
      }
    }
    tasks.push(task);
  }
  return tasks;
}

/** Étape correspondant à un département, pour rattacher les retours écrits à la main. */
function stageForDepartment(department: string, shotStage: Stage): Stage {
  switch (department) {
    case 'LAYOUT':
      return 'layout';
    case 'ANIMATION':
      return stageIndex(shotStage) <= stageIndex('blocking') ? 'blocking' : 'anim';
    case 'FX':
      return 'anim';
    case 'LIGHTING':
    case 'MATTEPAINT':
      return 'lighting';
    case 'COMPOSITING':
    default:
      return 'comp';
  }
}

/** Points de contrôle d'une tâche, cochés quand elle est livrée. */
function checklistFor(department: string, done: boolean): { text: string; done: boolean }[] {
  const items: Record<string, string[]> = {
    LAYOUT: ['Camera blocked', 'Set dressed', 'Cut length approved'],
    ANIMATION: ['Blocking approved', 'Splined', 'Polish pass', 'Published with rig version'],
    FX: ['Setup cached', 'Interaction with ground', 'Cache published'],
    LIGHTING: ['Key and rim set', 'Sequence continuity checked', 'Render submitted'],
    COMPOSITING: ['Precomp assembled', 'Grain matched', 'Black level checked'],
    MODELING: ['Topology reviewed', 'UVs laid out', 'Proxy exported'],
    RIGGING: ['Controls named', 'Deformation reviewed', 'Published to library'],
    LOOKDEV: ['Turntable rendered', 'Variants set up', 'Texel density checked'],
    MATTEPAINT: ['Projection cards built', 'Perspective checked'],
    EDIT: ['Handles delivered'],
  };
  const list = items[department] ?? ['Delivered'];
  return list.map((text, index) => ({ text, done: done || index === 0 }));
}

/** Tâches et versions d'un asset de bibliothèque. */
function buildAssetTasks(asset: AssetSpec, context: BuildContext, rng: Rng): PlannedTask[] {
  const departments = context.project.pipeline.filter((d) => ASSET_DEPARTMENTS.includes(d));
  const wanted = departments.filter((department) => {
    if (department === 'RIGGING') return asset.type === 'CHARACTER';
    if (department === 'FX') return asset.type === 'FX';
    return true;
  });
  const reached = stageIndex(asset.stage);
  const tasks: PlannedTask[] = [];

  for (const [index, department] of wanted.entries()) {
    const done = reached >= stageIndex('lighting') || index < wanted.length - 1;
    const [windowStart, windowEnd] = DEPARTMENT_WINDOW[department] ?? [0, 90];
    const workers = context.workersByDepartment.get(department) ?? context.team;
    const assigneeKey = pickAuthor(asset, workers, rng);
    const versionCount = done ? rng.int(2, 3) : rng.int(1, 2);
    const reviewers = context.reviewersByDepartment.get(department) ?? context.team;

    const task: PlannedTask = {
      department,
      name: department.toLowerCase(),
      type: TASK_TYPE_BY_DEPARTMENT[department] ?? 'OTHER',
      assigneeKey,
      statusCode: done ? STATUS.final : rng.chance(0.5) ? STATUS.review : STATUS.inProgress,
      startDate: dayOffset(windowStart),
      dueDate: taskDue(done, windowEnd, rng),
      checklist: checklistFor(department, done),
      versions: [],
    };

    for (let v = 0; v < versionCount; v += 1) {
      const last = v === versionCount - 1;
      const progress = versionCount === 1 ? 1 : v / (versionCount - 1);
      const createdAt = dayOffset(windowStart + (windowEnd - windowStart) * (0.2 + progress * 0.7), 11 + v);
      const media: MediaSpec[] = [];
      if (department === 'MODELING' && asset.usd) media.push({ type: 'usdAsset', asset: asset.key });
      else if (department === 'RIGGING' && asset.glb) media.push({ type: 'glb', model: asset.glb });
      else if (department === 'LOOKDEV' && asset.usd) media.push({ type: 'usdAsset', asset: asset.key });
      if (media.length === 0 && asset.still) media.push({ type: 'still', ...asset.still });
      if (media.length === 0) media.push({ type: 'still', at: 60 });
      // Le scan est livré une fois, sur la dernière version de la première tâche.
      if (asset.splat && last && index === 0) media.push({ type: 'splat', ...asset.splat });

      const comments =
        last && asset.feedback
          ? asset.feedback.map((note) => convertFeedback(note, new Date(createdAt.getTime() + 5400000), rng))
          : generateComments(department, { createdAt, duration: 4 }, reviewers, context.team, rng);

      task.versions.push({
        name: versionName(v),
        department,
        authorKey: assigneeKey,
        createdAt,
        status: done && last ? 'PUBLISHED' : last ? 'REVIEW' : 'PUBLISHED',
        published: (done && last) || !last,
        media: media.map((m) =>
          toPlannedMedia(asset.name.replace(/\s+/g, ''), department, versionName(v), m),
        ),
        decision: {
          status: done && last ? 'Approved' : last ? 'Pending' : rng.chance(0.5) ? 'Retake' : 'CBB',
          byKey: rng.pick(reviewers),
          note: rng.pick(DECISION_NOTES[done && last ? 'Approved' : 'Pending']!),
          at: new Date(createdAt.getTime() + rng.int(6, 48) * 3600000),
        },
        comments,
        markers: [],
      });
    }
    tasks.push(task);
  }
  return tasks;
}

/** Statut de l'entité elle-même, déduit de son étape. */
function entityStatus(stage: Stage, omitted = false): string {
  if (omitted) return STATUS.omitted;
  if (stage === 'final') return STATUS.final;
  if (stage === 'briefed') return STATUS.ready;
  return STATUS.inProgress;
}

/** Déroule un projet entier. */
export function planProject(spec: ProjectSpec, memberDepartments: Map<string, string[]>): PlannedProject {
  const team = spec.team.map((t) => t.member);
  const workersByDepartment = new Map<string, string[]>();
  const reviewersByDepartment = new Map<string, string[]>();
  for (const department of spec.pipeline) {
    const workers = team.filter((key) => (memberDepartments.get(key) ?? []).includes(department));
    workersByDepartment.set(department, workers.length > 0 ? workers : team);
    reviewersByDepartment.set(department, reviewersFor(department, spec, memberDepartments));
  }
  const context: BuildContext = { project: spec, workersByDepartment, reviewersByDepartment, team };

  const shots: PlannedShot[] = [];
  for (const sequence of spec.sequences) {
    for (const shot of sequence.shots) {
      const rng = makeRng(`${spec.slug}:${sequence.code}:${shot.code}`);
      shots.push({
        spec: shot,
        sequence,
        statusCode: entityStatus(shot.stage, shot.omitted),
        tasks: buildShotTasks(shot, context, rng),
      });
    }
  }

  const assets: PlannedAsset[] = spec.assets.map((asset) => {
    const rng = makeRng(`${spec.slug}:asset:${asset.key}`);
    return {
      spec: asset,
      statusCode: entityStatus(asset.stage),
      tasks: buildAssetTasks(asset, context, rng),
    };
  });

  return { spec, shots, assets };
}
