// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Worker } from 'bullmq';
import ffmpeg from 'fluent-ffmpeg';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';

import { redisConnectionOptions } from '../lib/redis';
import { QUEUE_NAMES, type TimelineExportJobData } from '../services/JobService';
import { storage } from '../services/StorageService';
import { logger } from '../lib/logger';
import {
  concatList,
  masterKey,
  normalizeArgs,
  placeholderFilter,
  placeholderInputs,
  type ExportProfile,
} from '../lib/timelineExport';
import { exportPlan, type ExportSegment } from '../services/TimelineService';

/**
 * Export d'un montage automatique en un fichier unique (Phase 45).
 *
 * Chaque plan est d'abord ramené au profil commun du projet (résolution, cadence, audio
 * stéréo 48 kHz), puis l'ensemble est concaténé sans ré-encodage. Les plans manquants
 * deviennent des cartons noirs portant leur code : le master dure exactement ce que dure
 * le montage à l'écran, trous compris — un fichier plus court que la timeline serait un
 * mensonge sur l'état de la production.
 */

/** Texte porté par un carton dans le master (l'export n'a pas de contexte de langue). */
const PLACEHOLDER_LABEL = 'no media';

/** Encode un segment vers le profil commun, à partir d'un fichier local. */
function encodeSource(input: string, output: string, profile: ExportProfile): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(input)
      .outputOptions(normalizeArgs(profile))
      .output(output)
      .on('end', () => resolve())
      .on('error', reject)
      .run();
  });
}

/**
 * Lance le binaire ffmpeg directement.
 *
 * `fluent-ffmpeg` valide les formats d'entrée contre sa propre liste et rejette `lavfi`
 * (« Input formats lavfi are not available ») : or les cartons n'ont pas de fichier
 * source, ils sont entièrement synthétisés par ce device. On garde donc la bibliothèque
 * pour les fichiers réels, et on parle au binaire pour ce cas-là.
 */
function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.FFMPEG_PATH || 'ffmpeg', args, { windowsHide: true });
    let stderr = '';
    // La sortie d'erreur de ffmpeg est verbeuse : seule sa fin sert au diagnostic.
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-4000);
    });
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg (code ${code}) : ${stderr.slice(-600)}`)),
    );
  });
}

/**
 * Fabrique un carton noir de la durée voulue, marqué du code du plan.
 *
 * L'incrustation du texte dépend de `drawtext`, donc d'une configuration de polices
 * présente sur la machine (l'image du worker installe DejaVu). Là où elle manque, ffmpeg
 * échoue : on refait alors le carton sans texte plutôt que de perdre tout l'export — un
 * master avec des trous muets reste utilisable, un master absent non.
 */
async function encodePlaceholder(
  output: string,
  profile: ExportProfile,
  shotCode: string,
  duration: number,
): Promise<void> {
  try {
    await encodePlaceholderWith(output, profile, shotCode, duration, true);
  } catch (err) {
    logger.warn({ err }, `[timelineExport.worker] carton sans texte pour ${shotCode}`);
    await encodePlaceholderWith(output, profile, shotCode, duration, false);
  }
}

function encodePlaceholderWith(
  output: string,
  profile: ExportProfile,
  shotCode: string,
  duration: number,
  withText: boolean,
): Promise<void> {
  const { video, audio } = placeholderInputs(profile, duration);
  return runFfmpeg([
    '-f',
    'lavfi',
    '-i',
    video,
    '-f',
    'lavfi',
    '-i',
    audio,
    ...(withText ? ['-vf', placeholderFilter(profile, shotCode, PLACEHOLDER_LABEL)] : []),
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '20',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-ar',
    '48000',
    '-ac',
    '2',
    '-shortest',
    '-y',
    output,
  ]);
}

/** Colle les segments normalisés bout à bout, sans ré-encoder (`concat` demuxer). */
function concatSegments(listFile: string, output: string): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(listFile)
      .inputOptions(['-f', 'concat', '-safe', '0'])
      .outputOptions(['-c', 'copy', '-movflags', '+faststart'])
      .output(output)
      .on('end', () => resolve())
      .on('error', reject)
      .run();
  });
}

/** Prépare un segment (source encodée ou carton) et renvoie son chemin local. */
async function buildSegment(
  segment: ExportSegment,
  index: number,
  dir: string,
  profile: ExportProfile,
): Promise<string> {
  const output = join(dir, `seg${String(index).padStart(4, '0')}.mp4`);
  if (segment.storageKey === null) {
    await encodePlaceholder(output, profile, segment.shotCode, segment.duration);
    return output;
  }
  const source = join(dir, `src${String(index).padStart(4, '0')}`);
  await storage.downloadToFile(segment.storageKey, source);
  await encodeSource(source, output, profile);
  await rm(source, { force: true });
  return output;
}

async function handle(timelineId: number): Promise<void> {
  const plan = await exportPlan(timelineId);
  if (plan.segments.length === 0) throw new Error(`Montage ${timelineId} sans plan à exporter`);

  const dir = await mkdtemp(join(tmpdir(), 'review-timeline-'));
  try {
    const paths: string[] = [];
    for (const [index, segment] of plan.segments.entries()) {
      paths.push(await buildSegment(segment, index, dir, plan.profile));
    }
    const listFile = join(dir, 'concat.txt');
    await writeFile(listFile, concatList(paths), 'utf8');
    const master = join(dir, 'master.mp4');
    await concatSegments(listFile, master);
    await storage.uploadFile(masterKey(timelineId), master, 'video/mp4');
    logger.info(`[timelineExport.worker] ✓ montage=${timelineId} (${plan.segments.length} plans)`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export const timelineExportWorker = new Worker<TimelineExportJobData>(
  QUEUE_NAMES.TIMELINE_EXPORT,
  (job) => handle(job.data.timelineId),
  // Un seul export à la fois : chaque job encode un film entier, les paralléliser
  // saturerait la machine qui sert aussi les transcodages courants.
  { connection: redisConnectionOptions, autorun: false, concurrency: 1 },
);

timelineExportWorker.on('failed', (job, err) =>
  logger.error({ err }, `[timelineExport.worker] ✗ montage=${job?.data.timelineId}`),
);

/** Démarré par le process worker principal (cf. ffmpeg.worker). */
export function startTimelineExportWorker(): void {
  timelineExportWorker.run();
  logger.info('[timelineExport.worker] démarré.');
}
