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
import { parseSceneTimes, sceneFrames, SCENE_THRESHOLD } from '../lib/sceneDetect';
import { publishWorkerEvent } from '../lib/workerEvents';
import { resolveProjectIdForVersion } from '../lib/pipeline';
import {
  buildBurninFilters,
  buildSlateFilters,
  buildSlateLines,
  resolveBurninConfig,
  type BurninConfig,
  type BurninContext,
  type SlateInfo,
} from '../lib/burnin';
import { SETTING_KEYS } from '../lib/settings';
import { env } from '../config/env';
import { qualityEncoderArgs, bitrateEncoderArgs, type VideoEncoder } from '../lib/videoEncoder';
import { sha256File } from '../lib/checksum';
import { isClamavEnabled, scanFile } from '../lib/clamav';
import { logAudit } from '../services/AuditService';
import { isUsdModel, pickModelFile, sourceFormatLabel, type ModelConverter } from '../lib/modelConvert';
import { startStorageCleanupWorker } from './storageCleanup.worker';
import { startWebhookWorker } from './webhook.worker';

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

/** Binaire du convertisseur USD→glTF natif (env `USD_GLTF_CONVERTER`, ex. `guc`), ou undefined. */
function usdConverterBin(): string | undefined {
  const bin = env.USD_GLTF_CONVERTER?.trim();
  return bin ? bin : undefined;
}

/**
 * Convertit un modèle USD (usd/usdc/usda) en GLB (39.A). Préfère un convertisseur USD→glTF
 * **natif dédié** (`guc`) qui préserve matériaux UsdPreviewSurface & variantes ; en son absence
 * ou en cas d'échec, se rabat sur assimp (support USD expérimental). Renvoie le convertisseur
 * réellement utilisé (tracé dans `metadata.model`).
 */
async function convertUsdToGlb(input: string, output: string): Promise<ModelConverter> {
  const bin = usdConverterBin();
  if (bin) {
    try {
      // guc <input.usd|usdc|usda> <output.glb> — sortie glTF binaire déduite de l'extension.
      await execFileAsync(bin, [input, output]);
      await assertGlbProduced(output, `USD natif (${bin})`);
      return 'usd';
    } catch (err) {
      const e = err as { stderr?: string; message?: string };
      const detail = (e.stderr || e.message || '').toString().trim().slice(0, 300);
      logger.warn(`[ffmpeg.worker] convertisseur USD natif (${bin}) échoué, repli assimp: ${detail}`);
    }
  }
  await convertWithAssimp(input, output);
  return 'assimp';
}

/** Vérifie que le GLB a bien été produit et n'est pas vide. */
async function assertGlbProduced(output: string, who: string): Promise<void> {
  const { stat } = await import('node:fs/promises');
  const info = await stat(output).catch(() => null);
  if (!info || info.size === 0) throw new Error(`Conversion ${who}: GLB de sortie vide ou absent`);
}

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
async function convertArchiveToGlb(input: string, output: string): Promise<ModelConverter> {
  const { default: AdmZip } = await import('adm-zip');
  const extractDir = join(dirname(input), 'unzipped');
  try {
    new AdmZip(input).extractAllTo(extractDir, true);
  } catch (err) {
    const e = err as { message?: string };
    throw new Error(`Extraction de l'archive échouée: ${(e.message || 'erreur inconnue').slice(0, 300)}`);
  }
  const files = await walk(extractDir);
  // Choisit le fichier modèle de plus haute priorité (gltf > glb > fbx > obj… > usd)
  const chosen = pickModelFile(files);
  if (!chosen) throw new Error("Aucun fichier 3D reconnu dans l'archive (gltf/glb/fbx/obj/dae/stl/usd)");
  const e = extname(chosen).toLowerCase();
  if (e === '.glb') {
    await copyFile(chosen, output);
    return 'copy';
  }
  if (e === '.gltf') {
    await convertGltfToGlb(chosen, output); // résout scene.bin + textures relatifs
    return 'gltf';
  }
  // USD extrait d'un usdz : convertisseur natif si dispo (textures adjacentes résolues), sinon assimp.
  if (isUsdModel(e)) return convertUsdToGlb(chosen, output);
  await convertWithAssimp(chosen, output); // OBJ/FBX/DAE… avec ressources adjacentes
  return 'assimp';
}

/** Aiguille vers le bon convertisseur selon l'extension source ; renvoie le convertisseur utilisé. */
async function convertToGlb(input: string, output: string, ext: string): Promise<ModelConverter> {
  const e = ext.toLowerCase();
  if (e === '.zip' || e === '.usdz') return convertArchiveToGlb(input, output);
  if (e === '.gltf') {
    await convertGltfToGlb(input, output);
    return 'gltf';
  }
  if (isUsdModel(e)) return convertUsdToGlb(input, output);
  await convertWithAssimp(input, output);
  return 'assimp';
}

/** Sonde un fichier média et renvoie durée / dimensions / fps. */
function probe(
  path: string,
): Promise<{ duration?: number; width?: number; height?: number; fps?: number; hasAudio?: boolean }> {
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
        hasAudio: data.streams.some((s) => s.codec_type === 'audio'),
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

/** Burn-ins résolus pour un média : config effective + contexte + logo local éventuel. */
interface BurninJob {
  cfg: BurninConfig;
  ctx: BurninContext;
  logoPath: string | null;
  slateInfo: SlateInfo | null;
}

/**
 * Applique la chaîne vidéo (scale + burn-ins éventuels) à une commande fluent-ffmpeg.
 * Sans logo : simple `-vf`. Avec logo : `filter_complex` à deux entrées (le logo est
 * ajouté comme input et incrusté en bas droite), sortie mappée `[vout]` + audio optionnel.
 */
function applyVideoChain(
  cmd: ffmpeg.FfmpegCommand,
  scale: string,
  burnin: BurninJob | null,
  outHeight: number,
): string[] {
  const extra = burnin ? buildBurninFilters(burnin.cfg, burnin.ctx, outHeight) : [];
  const chain = [scale, ...extra].join(',');
  if (!burnin?.logoPath || !burnin.cfg.enabled || !burnin.cfg.showLogo) {
    return ['-vf', chain];
  }
  const m = Math.max(8, Math.round(outHeight / 60));
  const logoH = Math.max(24, Math.round(outHeight / 10));
  cmd.input(burnin.logoPath);
  cmd.complexFilter(
    `[0:v]${chain}[base];[1:v]scale=-1:${logoH}[lg];` +
      `[base][lg]overlay=main_w-overlay_w-${m}:main_h-overlay_h-${m}[vout]`,
  );
  return ['-map', '[vout]', '-map', '0:a?'];
}

/** Transcode une vidéo en proxy MP4 web (h264 + aac, faststart), avec fenêtre de trim en option. */
/**
 * Exécute un encodage avec l'encodeur configuré (37.D) ; si NVENC échoue (pas de GPU,
 * drivers absents), retombe automatiquement sur libx264.
 */
async function withEncoderFallback(run: (encoder: VideoEncoder) => Promise<void>): Promise<void> {
  try {
    await run(env.VIDEO_ENCODER);
  } catch (err) {
    if (env.VIDEO_ENCODER === 'libx264') throw err;
    logger.warn({ err }, `[ffmpeg.worker] ${env.VIDEO_ENCODER} indisponible — repli libx264`);
    await run('libx264');
  }
}

function transcodeProxy(
  input: string,
  output: string,
  window?: { startSec: number; durationSec: number },
  burnin?: BurninJob | null,
  srcHeight?: number,
  encoder: VideoEncoder = 'libx264',
): Promise<void> {
  return new Promise((resolve, reject) => {
    const cmd = ffmpeg(input);
    // Trim non-destructif (10.G-V10) : seek + durée, ré-encodage → coupe précise à la frame.
    if (window) cmd.setStartTime(window.startSec).setDuration(window.durationSec);
    const proxyHeight = Math.min(1080, srcHeight && srcHeight > 0 ? srcHeight : 1080);
    const mapping = applyVideoChain(cmd, 'scale=-2:min(1080\\,ih)', burnin ?? null, proxyHeight);
    cmd
      .outputOptions([
        ...qualityEncoderArgs(encoder, 23, 'veryfast'),
        '-pix_fmt yuv420p',
        '-c:a aac',
        '-movflags +faststart',
      ])
      .outputOptions(mapping)
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
  burnin?: BurninJob | null,
  encoder: VideoEncoder = 'libx264',
): Promise<void> {
  const gop = hlsGopSize(fps);
  return new Promise((resolve, reject) => {
    const cmd = ffmpeg(input);
    const mapping = applyVideoChain(cmd, `scale=-2:${height}`, burnin ?? null, height);
    cmd
      .outputOptions(mapping)
      .outputOptions(bitrateEncoderArgs(encoder, cfg.preset))
      .outputOptions([
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

/**
 * Passe de scene detection (34.H, opt-in admin) : frames retenues par `select(scene)`,
 * listées par showinfo sur stderr. Best effort — un échec renvoie une liste vide.
 */
function detectScenes(input: string): Promise<number[]> {
  return new Promise((resolve) => {
    let err = '';
    ffmpeg(input)
      .outputOptions(['-vf', `select='gt(scene,${SCENE_THRESHOLD})',showinfo`, '-an', '-f', 'null'])
      .output('/dev/null')
      .on('stderr', (line: string) => {
        err += line + '\n';
      })
      .on('end', () => resolve(parseSceneTimes(err)))
      .on('error', () => resolve([]))
      .run();
  });
}

/** Pose les marqueurs « Plan n » (remplace les précédents marqueurs auto du média). */
async function writeSceneMarkers(mediaId: number, frames: number[]): Promise<void> {
  await prisma.timelineMarker.deleteMany({
    where: { mediaObjectId: mediaId, authorId: null, name: { startsWith: 'Plan ' } },
  });
  if (frames.length === 0) return;
  await prisma.timelineMarker.createMany({
    // La coupe i ouvre le plan i+2 (le plan 1 commence à la frame 0, sans marqueur).
    data: frames.map((frame, i) => ({
      mediaObjectId: mediaId,
      frame,
      name: `Plan ${i + 2}`,
      color: '#64748b',
      authorId: null,
    })),
  });
  await publishWorkerEvent({ type: 'markers', mediaId });
}

/** Durée du slate d'identification en tête du dérivé client (35.A). */
const SLATE_SEC = 3;

/**
 * Résout la config burn-in effective du projet du média + le contexte d'incrustation
 * (shot/version) et télécharge le logo studio si nécessaire. `null` si tout est inactif.
 */
async function loadBurninSetup(
  mediaId: number,
  versionId: number,
  originalName: string,
  dir: string,
): Promise<BurninJob | null> {
  const projSel = { select: { name: true, settings: true } };
  const version = await prisma.version.findUnique({
    where: { id: versionId },
    select: {
      name: true,
      author: { select: { name: true } },
      task: {
        select: {
          shot: {
            select: { code: true, sequence: { select: { code: true } }, project: projSel },
          },
          asset: { select: { name: true, project: projSel } },
        },
      },
      asset: { select: { name: true, project: projSel } },
    },
  });
  if (!version) return null;
  const shot = version.task?.shot ?? null;
  const asset = version.task?.asset ?? version.asset ?? null;
  const project = shot?.project ?? asset?.project ?? null;
  const cfg = await resolveBurninConfig(project?.settings ?? null);
  if (!cfg.enabled && !cfg.slate) return null;

  const shotLabel = shot
    ? shot.sequence
      ? `${shot.sequence.code} · ${shot.code}`
      : shot.code
    : (asset?.name ?? null);
  const ctx: BurninContext = { shotLabel, versionLabel: version.name, fps: null };

  let logoPath: string | null = null;
  if (cfg.enabled && cfg.showLogo) {
    const logo = await prisma.setting.findUnique({ where: { key: SETTING_KEYS.STUDIO_LOGO } });
    if (logo?.value) {
      try {
        logoPath = join(dir, `logo${extname(logo.value) || '.png'}`);
        await storage.downloadToFile(logo.value, logoPath);
      } catch (err) {
        logger.warn({ err }, `[ffmpeg.worker] logo burn-in indisponible media=${mediaId}`);
        logoPath = null;
      }
    }
  }

  let slateInfo: SlateInfo | null = null;
  if (cfg.slate) {
    const studio = await prisma.studio.findFirst({ select: { name: true } });
    slateInfo = {
      studioName: studio?.name ?? 'ReView',
      projectName: project?.name ?? null,
      shotLabel,
      versionLabel: version.name,
      authorName: version.author?.name ?? null,
      fileName: originalName,
      date: new Date().toISOString().slice(0, 10),
    };
  }
  return { cfg, ctx, logoPath, slateInfo };
}

/** Rend l'image du slate (fond sombre + lignes centrées) aux dimensions du proxy. */
function makeSlateImage(output: string, width: number, height: number, lines: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(`color=c=0x0b0f14:s=${width}x${height}`)
      .inputFormat('lavfi')
      .outputOptions(['-vf', buildSlateFilters(lines, height).join(','), '-frames:v', '1'])
      .output(output)
      .on('end', () => resolve())
      .on('error', reject)
      .run();
  });
}

/**
 * Dérivé client (35.A) : slate de `SLATE_SEC` s concaténé en tête du proxy — servi
 * uniquement par les partages clients (le proxy de review reste intact : un slate en
 * tête décalerait toutes les annotations frame-par-frame).
 */
function buildClientDerivative(
  slatePng: string,
  proxyPath: string,
  output: string,
  opts: { width: number; height: number; fps: number; hasAudio: boolean },
  encoder: VideoEncoder = 'libx264',
): Promise<void> {
  const { width, height, fps, hasAudio } = opts;
  const slateV = `[0:v]fps=${fps},scale=${width}:${height},setsar=1,format=yuv420p[sv]`;
  return new Promise((resolve, reject) => {
    const cmd = ffmpeg()
      .input(slatePng)
      .inputOptions(['-loop 1', `-t ${SLATE_SEC}`]);
    if (hasAudio) {
      cmd
        .input('anullsrc=r=48000:cl=stereo')
        .inputFormat('lavfi')
        .inputOptions([`-t ${SLATE_SEC}`])
        .input(proxyPath)
        .complexFilter(`${slateV};[2:v]setsar=1[pv];[sv][1:a][pv][2:a]concat=n=2:v=1:a=1[v][a]`)
        .outputOptions(['-map', '[v]', '-map', '[a]', '-c:a', 'aac']);
    } else {
      cmd
        .input(proxyPath)
        .complexFilter(`${slateV};[1:v]setsar=1[pv];[sv][pv]concat=n=2:v=1:a=0[v]`)
        .outputOptions(['-map', '[v]']);
    }
    cmd
      .outputOptions([
        ...qualityEncoderArgs(encoder, 23, 'veryfast'),
        '-pix_fmt yuv420p',
        '-movflags +faststart',
      ])
      .output(output)
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
  burnin?: BurninJob | null,
): Promise<HlsRenditionMeta[]> {
  const hlsDir = join(dir, 'hls');
  await mkdir(hlsDir, { recursive: true });
  const built: HlsRendition[] = [];
  const metas = () =>
    built.map((b) => ({ height: b.height, width: b.width, videoBitrateK: b.videoBitrateK }));
  const todo = selectRenditions(cfg, srcHeight);
  for (const [i, r] of todo.entries()) {
    const name = renditionName(r.height);
    await withEncoderFallback((encoder) =>
      transcodeHlsRendition(input, hlsDir, name, r.height, r.videoBitrateK, cfg, srcFps, burnin, encoder),
    );
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

    // Checksum bout-en-bout (37.B) : le sha256 annoncé par le client doit correspondre
    // au fichier téléchargé (corruption réseau/storage → FAILED, jamais de dérivés faux).
    if (!sourceGone && typeof metadata.contentHash === 'string') {
      const actual = await sha256File(src);
      if (actual !== metadata.contentHash) {
        throw new Error(
          `Checksum invalide media=${mediaId} (attendu ${String(metadata.contentHash).slice(0, 12)}…, reçu ${actual.slice(0, 12)}…)`,
        );
      }
    }

    // Scan antivirus opt-in (37.E) : fichier infecté → objet déplacé en quarantaine,
    // média FAILED. clamd injoignable = erreur (retry BullMQ) — on ne publie pas sans scan.
    if (isClamavEnabled() && !sourceGone) {
      const scan = await scanFile(src);
      if (!scan.clean) {
        const quarantineKey = `quarantine/${mediaId}/${media.originalName}`;
        await storage.copyObject(media.storageKey, quarantineKey).catch(() => undefined);
        await storage.deleteObject(media.storageKey).catch(() => undefined);
        await prisma.mediaObject.update({
          where: { id: mediaId },
          data: {
            status: MediaStatus.FAILED,
            metadata: { ...metadata, quarantined: scan.virus, quarantineKey } as object,
          },
        });
        logAudit({
          action: 'MEDIA_QUARANTINED',
          entityType: 'MediaObject',
          entityId: mediaId,
          metadata: { virus: scan.virus, uploaderId: media.uploaderId },
        });
        logger.warn(`[ffmpeg.worker] média ${mediaId} en quarantaine (${scan.virus})`);
        return;
      }
    }

    if (kind === 'scan') {
      // Antivirus seul (37.E) : le préambule ci-dessus a déjà scanné/quarantainé.
      return;
    }

    if (kind === 'convert3d') {
      // Conversion → GLB pour model-viewer (corrige l'erreur DataView sur FBX/OBJ bruts)
      const glbPath = join(dir, 'model.glb');
      const converter = await convertToGlb(src, glbPath, ext);
      const glbKey = `derived/${mediaId}/model.glb`;
      await storage.uploadFile(glbKey, glbPath, 'model/gltf-binary');
      metadata.glbKey = glbKey;
      // Provenance de conversion (39.A) : format source + convertisseur, exposés en fiche technique.
      metadata.model = {
        sourceFormat: sourceFormatLabel(ext),
        converter,
        native: converter === 'usd',
      };
      await prisma.mediaObject.update({
        where: { id: mediaId },
        data: { status: MediaStatus.READY, metadata: metadata as object },
      });
    } else if (kind === 'transcode') {
      // Sonde + proxy + miniature pour la vidéo
      Object.assign(metadata, await probe(src));

      // Burn-ins configurables (35.A) : config effective du projet + contexte shot/version.
      // Best effort — un échec de résolution ne condamne pas le transcodage.
      const burnin = await loadBurninSetup(mediaId, media.versionId, media.originalName, dir).catch((err) => {
        logger.warn({ err }, `[ffmpeg.worker] burn-ins non résolus media=${mediaId}`);
        return null;
      });
      if (burnin) burnin.ctx.fps = typeof metadata.fps === 'number' ? metadata.fps : null;

      const proxyPath = join(dir, 'proxy.mp4');
      await withEncoderFallback((encoder) =>
        transcodeProxy(
          src,
          proxyPath,
          undefined,
          burnin,
          typeof metadata.height === 'number' ? metadata.height : undefined,
          encoder,
        ),
      );
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
          burnin,
        );
        metadata.hls = { renditions };
      }

      // Slate + dérivé client (35.A, best effort) : slate d'identification concaténé en
      // tête du proxy → `derived/{id}/client.mp4`, servi uniquement par les partages.
      if (burnin?.slateInfo) {
        try {
          const p = await probe(proxyPath);
          const pw = p.width ?? 0;
          const ph = p.height ?? 0;
          if (pw > 0 && ph > 0) {
            const slatePng = join(dir, 'slate.png');
            await makeSlateImage(slatePng, pw, ph, buildSlateLines(burnin.slateInfo));
            const clientPath = join(dir, 'client.mp4');
            await withEncoderFallback((encoder) =>
              buildClientDerivative(
                slatePng,
                proxyPath,
                clientPath,
                {
                  width: pw,
                  height: ph,
                  fps: Math.min(Math.max(Math.round(p.fps ?? 24), 1), 240),
                  hasAudio: p.hasAudio === true,
                },
                encoder,
              ),
            );
            const clientKey = `derived/${mediaId}/client.mp4`;
            await storage.uploadFile(clientKey, clientPath, 'video/mp4');
            metadata.clientProxyKey = clientKey;
            metadata.slateSec = SLATE_SEC;
          }
        } catch (err) {
          logger.warn({ err }, `[ffmpeg.worker] slate/dérivé client échoué media=${mediaId}`);
        }
      }

      // Scene detection (34.H, opt-in admin) : marqueurs auto « Plan n » aux coupes —
      // best effort, après l'ouverture de la lecture (READY déjà posé par la 1re rendition).
      if (tcfg.sceneDetection) {
        try {
          const fps = typeof metadata.fps === 'number' ? metadata.fps : 24;
          await writeSceneMarkers(mediaId, sceneFrames(await detectScenes(src), fps));
        } catch (err) {
          logger.warn({ err }, `[ffmpeg.worker] scene detection échouée media=${mediaId}`);
        }
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
      await withEncoderFallback((encoder) =>
        transcodeProxy(src, trimPath, { startSec, durationSec }, null, undefined, encoder),
      );
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
      // Un trim raté ne condamne pas le média (proxy d'origine servi) ; un scan en erreur
      // (clamd injoignable) non plus — BullMQ retente, seule une détection met FAILED.
      if (job.data.kind !== 'trim' && job.data.kind !== 'scan')
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
  // Même process worker : traite aussi la file de nettoyage storage (retry des orphelins)
  // et la livraison des webhooks (36.D — les POST sortants ne partent pas du serveur web).
  startStorageCleanupWorker();
  startWebhookWorker();
}
