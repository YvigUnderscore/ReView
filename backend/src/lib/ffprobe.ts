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
}

/** Cadence exacte, telle que le conteneur la déclare — jamais arrondie. */
export interface FrameRateFraction {
  num: number;
  den: number;
}

interface RawStream {
  codec_type?: unknown;
  width?: unknown;
  height?: unknown;
  r_frame_rate?: unknown;
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

/** Analyse la sortie JSON de ffprobe. Une sortie illisible donne un résultat vide. */
export function parseProbeOutput(raw: string): ProbeResult {
  let data: { format?: { duration?: unknown }; streams?: unknown };
  try {
    data = JSON.parse(raw) as typeof data;
  } catch {
    return {};
  }
  const streams: RawStream[] = Array.isArray(data.streams) ? (data.streams as RawStream[]) : [];
  const video = streams.find((s) => s.codec_type === 'video');
  const duration = asNumber(data.format?.duration);
  const rate = parseFrameRateFraction(video?.r_frame_rate);
  return {
    duration: duration !== undefined ? Math.round(duration * 100) / 100 : undefined,
    width: asNumber(video?.width),
    height: asNumber(video?.height),
    fps: parseFrameRate(video?.r_frame_rate),
    fpsNum: rate?.num,
    fpsDen: rate?.den,
    hasAudio: streams.some((s) => s.codec_type === 'audio'),
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
