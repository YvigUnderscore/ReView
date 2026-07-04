import { Worker } from 'bullmq';
import ffmpeg from 'fluent-ffmpeg';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join, extname, dirname } from 'node:path';
import { mkdtemp, rm, readdir, copyFile } from 'node:fs/promises';

const execFileAsync = promisify(execFile);
import { redisConnectionOptions } from '../lib/redis';
import { QUEUE_NAMES, type MediaJobData } from '../services/JobService';
import { prisma } from '../lib/prisma';
import { storage, StorageService } from '../services/StorageService';
import { MediaStatus } from '@prisma/client';

/**
 * Worker de traitement média (FFmpeg) — BullMQ.
 *
 * Flux : télécharge l'objet depuis MinIO vers un répertoire temporaire, traite avec
 * FFmpeg, repousse les dérivés vers MinIO, met à jour MediaObject (status, thumbnailKey,
 * metadata), puis nettoie le temporaire. Aucun fichier ne persiste sur le serveur app.
 *
 *  - thumbnail : miniature JPEG (frame ~1s pour la vidéo, redimensionnement pour l'image)
 *  - transcode : sonde (ffprobe) + proxy MP4 (h264/aac, faststart) + miniature
 *  - convert3d : conversion FBX/OBJ/USD… → GLB (assimp) pour model-viewer (9.A1)
 *
 * Lancer en process séparé : `node dist/workers/ffmpeg.worker.js` (service `worker` du compose).
 */

/** Convertit un .gltf (texte, buffers embarqués) en .glb binaire via gltf-import-export. */
async function convertGltfToGlb(input: string, output: string): Promise<void> {
  // Conversion pure JS (pas de binaire externe) — compatible model-viewer en sortie.
  const { ConvertGltfToGLB } = await import('gltf-import-export');
  try {
    ConvertGltfToGLB(input, output);
  } catch (err) {
    const e = err as { message?: string };
    throw new Error(`Conversion glTF→GLB échouée: ${(e.message || 'erreur inconnue').slice(0, 500)}`);
  }
  await assertGlbProduced(output, 'glTF→GLB');
}

/** Convertit un modèle 3D (FBX/OBJ/USD/DAE…) en GLB binaire via assimp. */
async function convertWithAssimp(input: string, output: string): Promise<void> {
  // assimp export <in> <out> -f glb2  → glTF2 binaire (.glb)
  // On capture stderr d'assimp pour remonter une erreur exploitable en cas d'échec.
  try {
    await execFileAsync('assimp', ['export', input, output, '-f', 'glb2']);
  } catch (err) {
    const e = err as { stderr?: string; stdout?: string; message?: string };
    const detail = (e.stderr || e.stdout || e.message || '').toString().trim().slice(0, 500);
    throw new Error(`Conversion assimp échouée: ${detail || 'erreur inconnue'}`);
  }
  await assertGlbProduced(output, 'assimp');
}

/** Vérifie que le GLB a bien été produit et n'est pas vide. */
async function assertGlbProduced(output: string, who: string): Promise<void> {
  const { stat } = await import('node:fs/promises');
  const info = await stat(output).catch(() => null);
  if (!info || info.size === 0) throw new Error(`Conversion ${who}: GLB de sortie vide ou absent`);
}

// Priorité de choix du fichier modèle principal dans une archive 3D.
const MODEL_PRIORITY = ['.gltf', '.glb', '.fbx', '.obj', '.dae', '.stl', '.usdc', '.usda', '.usd'];

/** Parcourt récursivement un dossier et renvoie tous les chemins de fichiers. */
async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}

/** Convertit une archive 3D (.zip / .usdz) : extrait, trouve le modèle principal, packe en GLB. */
async function convertArchiveToGlb(input: string, output: string): Promise<void> {
  const { default: AdmZip } = await import('adm-zip');
  const extractDir = join(dirname(input), 'unzipped');
  try {
    new AdmZip(input).extractAllTo(extractDir, true);
  } catch (err) {
    const e = err as { message?: string };
    throw new Error(`Extraction de l'archive échouée: ${(e.message || 'erreur inconnue').slice(0, 300)}`);
  }
  const files = await walk(extractDir);
  // Choisit le fichier modèle de plus haute priorité (gltf > glb > fbx > obj…)
  let chosen: string | null = null;
  let bestRank = Infinity;
  for (const f of files) {
    const rank = MODEL_PRIORITY.indexOf(extname(f).toLowerCase());
    if (rank !== -1 && rank < bestRank) {
      bestRank = rank;
      chosen = f;
    }
  }
  if (!chosen) throw new Error("Aucun fichier 3D reconnu dans l'archive (gltf/glb/fbx/obj/dae/stl/usd)");
  const e = extname(chosen).toLowerCase();
  if (e === '.glb') await copyFile(chosen, output);
  else if (e === '.gltf')
    await convertGltfToGlb(chosen, output); // résout scene.bin + textures relatifs
  else await convertWithAssimp(chosen, output); // OBJ/FBX/DAE… avec ressources adjacentes
}

/** Aiguille vers le bon convertisseur selon l'extension source. */
async function convertToGlb(input: string, output: string, ext: string): Promise<void> {
  const e = ext.toLowerCase();
  if (e === '.zip' || e === '.usdz') return convertArchiveToGlb(input, output);
  if (e === '.gltf') return convertGltfToGlb(input, output);
  return convertWithAssimp(input, output);
}

/** Sonde un fichier média et renvoie durée / dimensions / fps. */
function probe(path: string): Promise<{ duration?: number; width?: number; height?: number; fps?: number }> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(path, (err, data) => {
      if (err) return reject(err);
      const stream = data.streams.find((s) => s.codec_type === 'video');
      let fps: number | undefined;
      if (stream?.r_frame_rate && stream.r_frame_rate.includes('/')) {
        const [n, d] = stream.r_frame_rate.split('/').map(Number);
        if (n && d) fps = Math.round((n / d) * 100) / 100;
      }
      resolve({
        duration: data.format.duration ? Math.round(data.format.duration * 100) / 100 : undefined,
        width: stream?.width,
        height: stream?.height,
        fps,
      });
    });
  });
}

/** Génère une miniature JPEG (frame vidéo à ~1s, ou redimensionnement image). */
function makeThumbnail(input: string, output: string, isVideo: boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    const cmd = ffmpeg(input);
    if (isVideo) cmd.seekInput(1);
    cmd
      .outputOptions(['-vframes 1', '-vf scale=640:-2'])
      .output(output)
      .on('end', () => resolve())
      .on('error', reject)
      .run();
  });
}

/** Transcode une vidéo en proxy MP4 web (h264 + aac, faststart). */
function transcodeProxy(input: string, output: string): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(input)
      .outputOptions([
        '-c:v libx264',
        '-preset veryfast',
        '-crf 23',
        '-pix_fmt yuv420p',
        '-c:a aac',
        '-movflags +faststart',
        '-vf scale=-2:min(1080\\,ih)',
      ])
      .output(output)
      .on('end', () => resolve())
      .on('error', reject)
      .run();
  });
}

async function handle(mediaId: number, kind: MediaJobData['kind']): Promise<void> {
  const media = await prisma.mediaObject.findUnique({ where: { id: mediaId } });
  if (!media) throw new Error(`MediaObject ${mediaId} introuvable`);

  const dir = await mkdtemp(join(tmpdir(), 'review-'));
  try {
    // Conserver l'extension d'origine (assimp/ffmpeg détectent le format par extension)
    const ext = extname(media.originalName) || '.bin';
    const src = join(dir, `src${ext}`);
    await storage.downloadToFile(media.storageKey, src);

    const metadata: Record<string, unknown> = { ...(media.metadata as object) };

    if (kind === 'convert3d') {
      // Conversion → GLB pour model-viewer (corrige l'erreur DataView sur FBX/OBJ bruts)
      const glbPath = join(dir, 'model.glb');
      await convertToGlb(src, glbPath, ext);
      const glbKey = `derived/${mediaId}/model.glb`;
      await storage.uploadFile(glbKey, glbPath, 'model/gltf-binary');
      metadata.glbKey = glbKey;
      await prisma.mediaObject.update({
        where: { id: mediaId },
        data: { status: MediaStatus.READY, metadata: metadata as object },
      });
    } else if (kind === 'transcode') {
      // Sonde + proxy + miniature pour la vidéo
      Object.assign(metadata, await probe(src));

      const proxyPath = join(dir, 'proxy.mp4');
      await transcodeProxy(src, proxyPath);
      const proxyKey = `derived/${mediaId}/proxy.mp4`;
      await storage.uploadFile(proxyKey, proxyPath, 'video/mp4');
      metadata.proxyKey = proxyKey;

      const thumbPath = join(dir, 'thumb.jpg');
      await makeThumbnail(src, thumbPath, true);
      const thumbKey = StorageService.thumbnailKey(mediaId, 'jpg');
      await storage.uploadFile(thumbKey, thumbPath, 'image/jpeg');

      await prisma.mediaObject.update({
        where: { id: mediaId },
        data: { status: MediaStatus.READY, thumbnailKey: thumbKey, metadata: metadata as object },
      });
    } else if (kind === 'thumbnail') {
      // Image : sonde dimensions + miniature
      Object.assign(metadata, await probe(src));
      const thumbPath = join(dir, 'thumb.jpg');
      await makeThumbnail(src, thumbPath, false);
      const thumbKey = StorageService.thumbnailKey(mediaId, 'jpg');
      await storage.uploadFile(thumbKey, thumbPath, 'image/jpeg');
      await prisma.mediaObject.update({
        where: { id: mediaId },
        data: { status: MediaStatus.READY, thumbnailKey: thumbKey, metadata: metadata as object },
      });
    } else {
      throw new Error(`Type de job inconnu: ${kind}`);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export const ffmpegWorker = new Worker<MediaJobData>(
  QUEUE_NAMES.MEDIA,
  async (job) => {
    try {
      await handle(job.data.mediaObjectId, job.data.kind);
    } catch (err) {
      await prisma.mediaObject
        .update({ where: { id: job.data.mediaObjectId }, data: { status: MediaStatus.FAILED } })
        .catch(() => undefined);
      throw err;
    }
  },
  { connection: redisConnectionOptions, autorun: false, concurrency: 2 },
);

ffmpegWorker.on('completed', (job) =>
  console.info(`[ffmpeg.worker] ✓ ${job.name} media=${job.data.mediaObjectId}`),
);
ffmpegWorker.on('failed', (job, err) =>
  console.error(`[ffmpeg.worker] ✗ media=${job?.data.mediaObjectId}: ${err.message}`),
);

if (require.main === module) {
  ffmpegWorker.run();
  console.info('[ffmpeg.worker] démarré.');
}
