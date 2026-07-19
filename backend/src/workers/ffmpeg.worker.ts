import { Worker } from 'bullmq';
import ffmpeg from 'fluent-ffmpeg';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join, extname, dirname } from 'node:path';
import { mkdtemp, rm, readdir, copyFile, mkdir, writeFile } from 'node:fs/promises';

const execFileAsync = promisify(execFile);
import { redisConnectionOptions } from '../lib/redis';
import { QUEUE_NAMES, type MediaJobData } from '../services/JobService';
import { prisma } from '../lib/prisma';
import { storage, StorageService } from '../services/StorageService';
import { MediaStatus } from '@prisma/client';
import { logger } from '../lib/logger';
import { getTranscodeConfig, selectRenditions, type TranscodeConfig } from '../lib/transcodeConfig';
import {
  buildMasterPlaylist,
  hlsContentType,
  hlsGopSize,
  HLS_SEGMENT_SEC,
  renditionName,
  type HlsRendition,
} from '../lib/hls';
import { planTimelineSprite, type TimelineSpritePlan } from '../lib/timelineSprite';
import { publishWorkerEvent } from '../lib/workerEvents';
import { resolveProjectIdForVersion } from '../lib/pipeline';
import { startStorageCleanupWorker } from './storageCleanup.worker';

/**
 * Worker de traitement média (FFmpeg) — BullMQ.
 *
 * Flux : télécharge l'objet depuis MinIO vers un répertoire temporaire, traite avec
 * FFmpeg, repousse les dérivés vers MinIO, met à jour MediaObject (status, thumbnailKey,
 * metadata), puis nettoie le temporaire. Aucun fichier ne persiste sur le serveur app.
 *
 *  - thumbnail : miniature JPEG (redimensionnement pour l'image ; la vidéo capture au centre)
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

/**
 * Génère une miniature JPEG. Pour la vidéo, on capture la frame au **centre** (`seekSec`,
 * typiquement durée/2 — plus représentatif qu'une frame de début souvent noire) ; pour
 * l'image, pas de seek (redimensionnement direct).
 */
function makeThumbnail(input: string, output: string, seekSec?: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const cmd = ffmpeg(input);
    if (seekSec !== undefined && seekSec > 0) cmd.seekInput(seekSec);
    cmd
      .outputOptions(['-vframes 1', '-vf scale=640:-2'])
      .output(output)
      .on('end', () => resolve())
      .on('error', reject)
      .run();
  });
}

/** Tuile les vignettes de timeline (1 frame / intervalle) dans un unique JPEG léger. */
function makeTimelineSprite(input: string, output: string, plan: TimelineSpritePlan): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(input)
      .outputOptions([
        '-vf',
        `fps=1/${plan.intervalSec},scale=${plan.tileW}:${plan.tileH},tile=${plan.cols}x${plan.rows}`,
        '-frames:v',
        '1',
        '-q:v',
        '7',
      ])
      .output(output)
      .on('end', () => resolve())
      .on('error', reject)
      .run();
  });
}

/** Transcode une vidéo en proxy MP4 web (h264 + aac, faststart), avec fenêtre de trim en option. */
function transcodeProxy(
  input: string,
  output: string,
  window?: { startSec: number; durationSec: number },
): Promise<void> {
  return new Promise((resolve, reject) => {
    const cmd = ffmpeg(input);
    // Trim non-destructif (10.G-V10) : seek + durée, ré-encodage → coupe précise à la frame.
    if (window) cmd.setStartTime(window.startSec).setDuration(window.durationSec);
    cmd
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

/**
 * Génère une rendition HLS (VOD, segments .ts + sous-playlist) dans `hlsDir` (Phase 23).
 * GOP **fixe** calé sur le fps (une keyframe par segment, scene-cut désactivé) : sans lui,
 * libx264 espace les keyframes jusqu'à ~10 s → segments énormes, switch de qualité très
 * lent et image figée pendant que l'audio continue.
 */
function transcodeHlsRendition(
  input: string,
  hlsDir: string,
  name: string,
  height: number,
  videoBitrateK: number,
  cfg: Pick<TranscodeConfig, 'preset' | 'audioBitrateK'>,
  fps?: number,
): Promise<void> {
  const gop = hlsGopSize(fps);
  return new Promise((resolve, reject) => {
    ffmpeg(input)
      .outputOptions([
        '-vf',
        `scale=-2:${height}`,
        '-c:v',
        'libx264',
        '-preset',
        cfg.preset,
        '-b:v',
        `${videoBitrateK}k`,
        '-maxrate',
        `${Math.round(videoBitrateK * 1.07)}k`,
        '-bufsize',
        `${Math.round(videoBitrateK * 1.5)}k`,
        '-g',
        String(gop),
        '-keyint_min',
        String(gop),
        '-sc_threshold',
        '0',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-b:a',
        `${cfg.audioBitrateK}k`,
        '-hls_time',
        String(HLS_SEGMENT_SEC),
        '-hls_playlist_type',
        'vod',
        '-hls_segment_filename',
        join(hlsDir, `${name}_%03d.ts`),
      ])
      .output(join(hlsDir, `${name}.m3u8`))
      .on('end', () => resolve())
      .on('error', reject)
      .run();
  });
}

type HlsRenditionMeta = { height: number; width: number; videoBitrateK: number };

/**
 * Produit l'échelle HLS adaptative (renditions + master.m3u8) et la pousse dans MinIO sous
 * `derived/{id}/hls/`. **Progressif (34.F)** : `selectRenditions` renvoie la plus basse en
 * premier — chaque rendition est uploadée dès qu'elle est prête, le master est régénéré à
 * chaque fois, et `onRendition` permet à l'appelant d'ouvrir la lecture dès la première.
 * Renvoie les renditions produites (métadonnées) ou `[]` si désactivé.
 */
async function buildHls(
  input: string,
  dir: string,
  mediaId: number,
  cfg: TranscodeConfig,
  srcWidth: number,
  srcHeight: number,
  srcFps?: number,
  onRendition?: (renditions: HlsRenditionMeta[], building: boolean) => Promise<void>,
): Promise<HlsRenditionMeta[]> {
  const hlsDir = join(dir, 'hls');
  await mkdir(hlsDir, { recursive: true });
  const built: HlsRendition[] = [];
  const metas = () =>
    built.map((b) => ({ height: b.height, width: b.width, videoBitrateK: b.videoBitrateK }));
  const todo = selectRenditions(cfg, srcHeight);
  for (const [i, r] of todo.entries()) {
    const name = renditionName(r.height);
    await transcodeHlsRendition(input, hlsDir, name, r.height, r.videoBitrateK, cfg, srcFps);
    const width =
      srcWidth > 0 && srcHeight > 0
        ? Math.round(((srcWidth / srcHeight) * r.height) / 2) * 2
        : Math.round(((16 / 9) * r.height) / 2) * 2;
    built.push({
      height: r.height,
      width,
      videoBitrateK: r.videoBitrateK,
      audioBitrateK: cfg.audioBitrateK,
      playlist: `${name}.m3u8`,
    });
    // Upload de la rendition (segments + sous-playlist) puis master régénéré : le master
    // en ligne ne référence jamais une rendition absente.
    await writeFile(join(hlsDir, 'master.m3u8'), buildMasterPlaylist(built));
    for (const f of (await readdir(hlsDir)).filter((f) => f === `${name}.m3u8` || f.startsWith(`${name}_`))) {
      await storage.uploadFile(`derived/${mediaId}/hls/${f}`, join(hlsDir, f), hlsContentType(f));
    }
    await storage.uploadFile(
      `derived/${mediaId}/hls/master.m3u8`,
      join(hlsDir, 'master.m3u8'),
      hlsContentType('master.m3u8'),
    );
    await onRendition?.(metas(), i < todo.length - 1);
  }
  return metas();
}

async function handle(mediaId: number, kind: MediaJobData['kind']): Promise<void> {
  const media = await prisma.mediaObject.findUnique({ where: { id: mediaId } });
  if (!media) throw new Error(`MediaObject ${mediaId} introuvable`);

  const dir = await mkdtemp(join(tmpdir(), 'review-'));
  try {
    const metadata: Record<string, unknown> = { ...(media.metadata as object) };
    // Source vidéo supprimée après transcodage (gain de place) : les retraitements
    // (trim, reprocess) repartent du proxy MP4 — seul fichier « source » restant.
    const sourceGone = metadata.sourceDeleted === true && typeof metadata.proxyKey === 'string';
    // Conserver l'extension d'origine (assimp/ffmpeg détectent le format par extension)
    const ext = sourceGone ? '.mp4' : extname(media.originalName) || '.bin';
    const src = join(dir, `src${ext}`);
    await storage.downloadToFile(sourceGone ? (metadata.proxyKey as string) : media.storageKey, src);

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
      // Frame au centre de la vidéo (durée/2) — repli à 1 s si la durée est inconnue.
      const midSec =
        typeof metadata.duration === 'number' && metadata.duration > 0 ? metadata.duration / 2 : 1;
      await makeThumbnail(src, thumbPath, midSec);
      const thumbKey = StorageService.thumbnailKey(mediaId, 'jpg');
      await storage.uploadFile(thumbKey, thumbPath, 'image/jpeg');

      // HLS adaptatif (Phase 23) : échelle multi-rendition + master, si activé et hauteur connue.
      // Progressif (34.F) : le média passe READY dès la PREMIÈRE rendition (lecture possible
      // pendant que les qualités supérieures se transcodent) ; chaque rendition met à jour
      // metadata.hls (flag `building`) et publie un événement relayé en socket à la review.
      const tcfg = await getTranscodeConfig();
      const srcHeight = typeof metadata.height === 'number' ? metadata.height : 0;
      const srcWidth = typeof metadata.width === 'number' ? metadata.width : 0;
      if (tcfg.enabled && srcHeight > 0) {
        const srcFps = typeof metadata.fps === 'number' ? metadata.fps : undefined;
        const projectId = await resolveProjectIdForVersion(media.versionId);
        let readyPosted = false;
        const renditions = await buildHls(
          src,
          dir,
          mediaId,
          tcfg,
          srcWidth,
          srcHeight,
          srcFps,
          async (soFar, building) => {
            metadata.hls = building ? { renditions: soFar, building: true } : { renditions: soFar };
            await prisma.mediaObject.update({
              where: { id: mediaId },
              data: readyPosted
                ? { metadata: metadata as object }
                : { status: MediaStatus.READY, thumbnailKey: thumbKey, metadata: metadata as object },
            });
            readyPosted = true;
            await publishWorkerEvent({
              type: 'hls',
              mediaId,
              versionId: media.versionId,
              projectId,
              renditions: soFar.length,
              building,
            });
          },
        );
        metadata.hls = { renditions };
      }

      // Sprite de timeline (vignette ~toutes les 3 s, un seul JPEG) — best effort :
      // un échec de sprite ne condamne pas le transcodage.
      const plan = planTimelineSprite(
        typeof metadata.duration === 'number' ? metadata.duration : undefined,
        srcWidth,
        srcHeight,
      );
      if (plan) {
        try {
          const spritePath = join(dir, 'timeline-sprite.jpg');
          await makeTimelineSprite(src, spritePath, plan);
          const spriteKey = `derived/${mediaId}/timeline-sprite.jpg`;
          await storage.uploadFile(spriteKey, spritePath, 'image/jpeg');
          metadata.timelineSprite = { ...plan, key: spriteKey };
        } catch (err) {
          logger.warn({ err }, `[ffmpeg.worker] sprite timeline échoué media=${mediaId}`);
        }
      }

      // Tous les dérivés sont produits : la source originale ne sert plus — supprimée
      // pour libérer l'espace (le flag est posé AVANT le delete : en cas d'échec du
      // delete, seul l'espace n'est pas récupéré, les URLs pointent déjà le proxy).
      metadata.sourceDeleted = true;
      await prisma.mediaObject.update({
        where: { id: mediaId },
        data: { status: MediaStatus.READY, thumbnailKey: thumbKey, metadata: metadata as object },
      });
      if (!sourceGone)
        await storage
          .deleteObject(media.storageKey)
          .catch((err) =>
            logger.warn({ err }, `[ffmpeg.worker] suppression source échouée media=${mediaId}`),
          );
    } else if (kind === 'trim') {
      // Trim non-destructif (10.G-V10) : proxy trimé depuis l'original, borné par metadata.trim.
      const trim = metadata.trim as { inFrame?: number; outFrame?: number } | undefined;
      const fps = typeof metadata.fps === 'number' && metadata.fps > 0 ? metadata.fps : 24;
      if (!trim || typeof trim.inFrame !== 'number' || typeof trim.outFrame !== 'number') {
        logger.warn(`[ffmpeg.worker] trim media=${mediaId} sans metadata.trim — ignoré`);
        return;
      }
      const startSec = trim.inFrame / fps;
      const durationSec = Math.max((trim.outFrame - trim.inFrame) / fps, 1 / fps);
      const trimPath = join(dir, 'proxy-trim.mp4');
      await transcodeProxy(src, trimPath, { startSec, durationSec });
      const trimProxyKey = `derived/${mediaId}/proxy-trim.mp4`;
      await storage.uploadFile(trimProxyKey, trimPath, 'video/mp4');
      // Relit le metadata au moment de l'écriture (le trim a pu être modifié/effacé pendant
      // le job — dans ce cas la clé posée ne correspondrait plus : on ne l'écrit que si le
      // trim en base est toujours celui traité).
      const fresh = await prisma.mediaObject.findUnique({ where: { id: mediaId } });
      const freshMeta: Record<string, unknown> = { ...((fresh?.metadata ?? {}) as object) };
      const freshTrim = freshMeta.trim as { inFrame?: number; outFrame?: number } | undefined;
      if (freshTrim?.inFrame === trim.inFrame && freshTrim?.outFrame === trim.outFrame) {
        freshMeta.trimProxyKey = trimProxyKey;
        await prisma.mediaObject.update({
          where: { id: mediaId },
          data: { metadata: freshMeta as object },
        });
      } else {
        await storage.deleteObject(trimProxyKey).catch(() => undefined);
      }
    } else if (kind === 'thumbnail') {
      // Image : sonde dimensions + miniature
      Object.assign(metadata, await probe(src));
      const thumbPath = join(dir, 'thumb.jpg');
      await makeThumbnail(src, thumbPath);
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
      // Un trim raté ne condamne pas le média : il reste READY (proxy d'origine servi).
      if (job.data.kind !== 'trim')
        await prisma.mediaObject
          .update({ where: { id: job.data.mediaObjectId }, data: { status: MediaStatus.FAILED } })
          .catch(() => undefined);
      throw err;
    }
  },
  { connection: redisConnectionOptions, autorun: false, concurrency: 2 },
);

ffmpegWorker.on('completed', (job) =>
  logger.info(`[ffmpeg.worker] ✓ ${job.name} media=${job.data.mediaObjectId}`),
);
ffmpegWorker.on('failed', (job, err) =>
  logger.error({ err }, `[ffmpeg.worker] ✗ media=${job?.data.mediaObjectId}`),
);

if (require.main === module) {
  ffmpegWorker.run();
  logger.info('[ffmpeg.worker] démarré.');
  // Même process worker : traite aussi la file de nettoyage storage (retry des orphelins).
  startStorageCleanupWorker();
}
