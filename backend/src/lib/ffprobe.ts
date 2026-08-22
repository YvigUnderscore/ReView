// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { spawn } from 'node:child_process';
import { FFPROBE_TIMEOUT_MS, ffmpegTimeoutMessage } from './ffmpegTimeout';

/**
 * Sonde ffprobe.
 *
 * On parle au binaire plutôt qu'à `fluent-ffmpeg.ffprobe`, pour une raison précise :
 * la bibliothèque ne rend pas la main sur le processus enfant, donc une sonde qui se
 * bloque sur un flux corrompu ne peut pas être tuée — elle immobilise l'emplacement de
 * file jusqu'au redémarrage du worker. Ici la sonde a un délai, et le processus est tué.
 * Bénéfice second : l'analyse de la sortie devient une fonction pure, donc testable.
 */

export interface ProbeResult {
  duration?: number;
  width?: number;
  height?: number;
  fps?: number;
  /** Numérateur de la cadence exacte (« 24000 » pour 24000/1001). */
  fpsNum?: number;
  /** Dénominateur de la cadence exacte (« 1001 » pour 24000/1001). */
  fpsDen?: number;
  hasAudio?: boolean;
  /**
   * Ordre de trame déclaré par le conteneur (`progressive`, `tt`, `bb`, `tb`, `bt`).
   * Les masters MXF/AVI de diffusion sont fréquemment entrelacés : sans ce champ, le
   * proxy sort peigné et le superviseur juge une image que personne n'a livrée.
   */
  fieldOrder?: string;
  /** Nombre de canaux de la piste audio retenue (6 pour un 5.1). */
  audioChannels?: number;
  /** Codec de la piste vidéo retenue (`prores`, `dnxhd`, `h264`…) — trace de provenance. */
  videoCodec?: string;
}

/** Cadence exacte, telle que le conteneur la déclare — jamais arrondie. */
export interface FrameRateFraction {
  num: number;
  den: number;
}

interface RawStream {
  codec_type?: unknown;
  codec_name?: unknown;
  width?: unknown;
  height?: unknown;
  r_frame_rate?: unknown;
  field_order?: unknown;
  channels?: unknown;
  disposition?: { attached_pic?: unknown };
}

const asNumber = (v: unknown): number | undefined => {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : Number.NaN;
  return Number.isFinite(n) ? n : undefined;
};

/**
 * Cadence depuis `r_frame_rate` (« 24000/1001 »), arrondie au centième — c'est la valeur
 * historique du champ `metadata.fps`, sur laquelle reposent tous les compteurs de frame.
 *
 * Conservée telle quelle : les médias déjà en base ne portent que ce nombre, et tout ce qui
 * l'affiche (« 23.98 fps ») ou le relit continue de fonctionner. La cadence **exacte** vient
 * en plus, dans `fpsNum`/`fpsDen` — cf. `parseFrameRateFraction`.
 */
export function parseFrameRate(raw: unknown): number | undefined {
  if (typeof raw !== 'string' || !raw.includes('/')) return undefined;
  const [n, d] = raw.split('/').map(Number);
  if (!n || !d || !Number.isFinite(n) || !Number.isFinite(d)) return undefined;
  return Math.round((n / d) * 100) / 100;
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/**
 * Cadence **exacte** en fraction irréductible : 24000/1001, pas 23.98.
 *
 * L'arrondi au centième dérive de 0,003976 frame par seconde à 23,976 fps — une frame
 * entière d'écart au bout de quatre minutes. Le numéro de frame qu'un superviseur cite dans
 * un retour ne désigne alors plus la même image que celle ouverte dans le DCC. On garde donc
 * les deux termes de la fraction, seule forme dont aucun compteur ne dérive.
 */
export function parseFrameRateFraction(raw: unknown): FrameRateFraction | undefined {
  if (typeof raw !== 'string' || !raw.includes('/')) return undefined;
  const [n, d] = raw.split('/').map(Number);
  if (!n || !d || !Number.isFinite(n) || !Number.isFinite(d) || n < 0 || d < 0) return undefined;
  // Réduction seulement sur des entiers : `30000/1001` se réduit, `29.97/1` n'a rien à réduire.
  if (!Number.isInteger(n) || !Number.isInteger(d)) return { num: n, den: d };
  const g = gcd(n, d);
  return { num: n / g, den: d / g };
}

/**
 * Piste vidéo **utile** d'un conteneur.
 *
 * `streams.find(codec_type === 'video')` prenait la première venue. Or un master ProRes en
 * MOV, un MXF de diffusion ou un MP4 sorti d'un NLE embarquent régulièrement une pochette
 * (`disposition.attached_pic`) ou une vignette de 120 px : sondée, elle devenait la
 * définition du média — proxy transcodé en 120 px de haut, échelle HLS entière calculée
 * dessus, letterbox de review faux. On écarte donc les images attachées et, à défaut de
 * critère plus sûr, on retient la piste de plus grande surface.
 */
function pickVideoStream(streams: RawStream[]): RawStream | undefined {
  const candidates = streams.filter((s) => s.codec_type === 'video' && s.disposition?.attached_pic !== 1);
  const pool = candidates.length > 0 ? candidates : streams.filter((s) => s.codec_type === 'video');
  const area = (s: RawStream): number => (asNumber(s.width) ?? 0) * (asNumber(s.height) ?? 0);
  return pool.reduce<RawStream | undefined>(
    (best, s) => (best === undefined || area(s) > area(best) ? s : best),
    undefined,
  );
}

/**
 * Le média est-il entrelacé ? `unknown` et `progressive` valent « non » : on ne
 * désentrelace jamais sur un doute — la passe coûte une frame de netteté.
 */
export function isInterlaced(fieldOrder: string | undefined): boolean {
  return fieldOrder !== undefined && ['tt', 'bb', 'tb', 'bt'].includes(fieldOrder);
}

/** Analyse la sortie JSON de ffprobe. Une sortie illisible donne un résultat vide. */
export function parseProbeOutput(raw: string): ProbeResult {
  let data: { format?: { duration?: unknown }; streams?: unknown };
  try {
    data = JSON.parse(raw) as typeof data;
  } catch {
    return {};
  }
  const streams: RawStream[] = Array.isArray(data.streams) ? (data.streams as RawStream[]) : [];
  const video = pickVideoStream(streams);
  // Piste audio la plus « riche » : un master MXF porte souvent plusieurs pistes, dont le
  // downmix stéréo et des stems mono. C'est le nombre de canaux qui décide du downmix.
  const audio = streams
    .filter((s) => s.codec_type === 'audio')
    .reduce<RawStream | undefined>(
      (best, s) =>
        best === undefined || (asNumber(s.channels) ?? 0) > (asNumber(best.channels) ?? 0) ? s : best,
      undefined,
    );
  const duration = asNumber(data.format?.duration);
  const rate = parseFrameRateFraction(video?.r_frame_rate);
  return {
    duration: duration !== undefined ? Math.round(duration * 100) / 100 : undefined,
    width: asNumber(video?.width),
    height: asNumber(video?.height),
    fps: parseFrameRate(video?.r_frame_rate),
    fpsNum: rate?.num,
    fpsDen: rate?.den,
    hasAudio: audio !== undefined,
    fieldOrder: typeof video?.field_order === 'string' ? video.field_order : undefined,
    audioChannels: asNumber(audio?.channels),
    videoCodec: typeof video?.codec_name === 'string' ? video.codec_name : undefined,
  };
}

/** Arguments de la sonde (extraits pour être vérifiés sans lancer de processus). */
export function probeArgs(path: string): string[] {
  return ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', '-i', path];
}

/** Sonde un fichier local. Dépassement du délai → processus tué et erreur explicite. */
export function probeFile(path: string, timeoutMs: number = FFPROBE_TIMEOUT_MS): Promise<ProbeResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.FFPROBE_PATH || 'ffprobe', probeArgs(path), {
      windowsHide: true,
    });
    let stdout = '';
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(() => reject(new Error(ffmpegTimeoutMessage('probe', timeoutMs))));
    }, timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.on('error', (err) => finish(() => reject(err)));
    child.on('close', (code) =>
      finish(() =>
        code === 0
          ? resolve(parseProbeOutput(stdout))
          : reject(new Error(`ffprobe failed (exit code ${String(code)}) on ${path}`)),
      ),
    );
  });
}
