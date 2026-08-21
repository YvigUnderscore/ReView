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
  hasAudio?: boolean;
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
 */
export function parseFrameRate(raw: unknown): number | undefined {
  if (typeof raw !== 'string' || !raw.includes('/')) return undefined;
  const [n, d] = raw.split('/').map(Number);
  if (!n || !d || !Number.isFinite(n) || !Number.isFinite(d)) return undefined;
  return Math.round((n / d) * 100) / 100;
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
  return {
    duration: duration !== undefined ? Math.round(duration * 100) / 100 : undefined,
    width: asNumber(video?.width),
    height: asNumber(video?.height),
    fps: parseFrameRate(video?.r_frame_rate),
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
