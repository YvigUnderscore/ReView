// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';

/**
 * Worker d'export de montage — les décisions, pas les octets.
 *
 * Les 297 lignes de ce worker n'avaient aucun test : ni Redis, ni ffmpeg, ni MinIO ne sont
 * disponibles dans une suite unitaire, et rien de pur n'en est exporté. On capture donc le
 * processeur que le worker confie à BullMQ et on l'appelle directement, ffmpeg et stockage
 * doublés. Ce qui est vérifié est ce que le fichier promet : un master qui dure exactement
 * ce que dure la timeline (les plans manquants deviennent des cartons, ils ne disparaissent
 * pas), un carton sans texte plutôt qu'un export perdu quand `drawtext` manque, et le
 * temporaire effacé même en cas d'échec.
 */

type Processor = (job: {
  data: { timelineId: number };
  updateProgress: (p: number) => Promise<void>;
}) => Promise<void>;

// `vi.hoisted` : les fabriques de `vi.mock` sont remontées au-dessus des déclarations.
const captured = vi.hoisted((): { processor?: Processor } => ({}));

vi.mock('bullmq', () => ({
  Worker: class {
    constructor(
      readonly name: string,
      processor: Processor,
      readonly opts: unknown,
    ) {
      captured.processor = processor;
    }
    on() {
      return this;
    }
    run() {
      return Promise.resolve();
    }
  },
  // `JobService` construit ses files à l'import : sans ce double, il ouvrirait Redis.
  Queue: class {
    constructor(readonly name: string) {}
    add() {
      return Promise.resolve({});
    }
  },
}));

/** Chaque appel ffmpeg réussit, sauf si `ffmpegFails` porte une erreur pour cette étape. */
const ffmpegCalls: { inputs: string[]; output: string }[] = [];
let ffmpegError: Error | null = null;

vi.mock('fluent-ffmpeg', () => {
  const factory = (input?: string) => {
    const call: { inputs: string[]; output: string } = { inputs: input ? [input] : [], output: '' };
    const emitter = new EventEmitter() as EventEmitter & Record<string, unknown>;
    const api = {
      input: (i: string) => {
        call.inputs.push(i);
        return api;
      },
      inputOptions: () => api,
      outputOptions: () => api,
      output: (o: string) => {
        call.output = o;
        return api;
      },
      kill: () => undefined,
      on: (event: string, handler: (...args: unknown[]) => void) => {
        emitter.on(event, handler);
        return api;
      },
      run: () => {
        ffmpegCalls.push(call);
        setImmediate(() => {
          if (ffmpegError) emitter.emit('error', ffmpegError);
          else emitter.emit('end');
        });
        return api;
      },
    };
    return api;
  };
  return { default: factory };
});

/**
 * Cartons : le worker parle au binaire directement (lavfi est refusé par fluent-ffmpeg).
 * `spawnExitCodes` se consomme appel par appel — de quoi faire échouer le premier seulement.
 */
const spawnCalls: string[][] = [];
const spawnExitCodes: number[] = [];

vi.mock('node:child_process', () => ({
  spawn: (_bin: string, args: string[]) => {
    spawnCalls.push(args);
    const code = spawnExitCodes.shift() ?? 0;
    const child = new EventEmitter() as EventEmitter & { stderr: EventEmitter; kill: () => void };
    child.stderr = new EventEmitter();
    child.kill = () => undefined;
    setImmediate(() => child.emit('close', code));
    return child;
  },
}));

const removed: string[] = [];
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    writeFile: vi.fn().mockResolvedValue(undefined),
    rm: vi.fn((target: string) => {
      removed.push(target);
      return Promise.resolve();
    }),
  };
});

vi.mock('../lib/redis', () => ({ redisConnectionOptions: {} }));
vi.mock('../services/StorageService', () => ({
  storage: {
    downloadToFile: vi.fn().mockResolvedValue(undefined),
    uploadFile: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock('../services/TimelineService', () => ({ exportPlan: vi.fn() }));
vi.mock('../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('./shutdown', () => ({ registerWorkerShutdown: vi.fn() }));

import './timelineExport.worker';
import { storage } from '../services/StorageService';
import { exportPlan } from '../services/TimelineService';
import { logger } from '../lib/logger';
import { masterKey } from '../lib/timelineExport';

const PROFILE = { width: 1920, height: 1080, fps: 24 };

const plan = (segments: { shotCode: string; duration: number; storageKey: string | null }[]) => ({
  timelineId: 7,
  projectId: 1,
  profile: PROFILE,
  segments,
});

/** Joue le processeur du worker et rend la suite des progressions rapportées. */
async function runJob(timelineId = 7): Promise<number[]> {
  const progress: number[] = [];
  await captured.processor!({
    data: { timelineId },
    updateProgress: (p: number) => {
      progress.push(p);
      return Promise.resolve();
    },
  });
  return progress;
}

beforeEach(() => {
  ffmpegCalls.length = 0;
  spawnCalls.length = 0;
  removed.length = 0;
  spawnExitCodes.length = 0;
  ffmpegError = null;
  vi.mocked(storage.uploadFile).mockClear();
  vi.mocked(storage.downloadToFile).mockClear();
  vi.mocked(logger.warn).mockClear();
});

describe('timelineExport.worker — export d’un montage', () => {
  it('encode chaque plan puis dépose le master sous la clé du montage', async () => {
    vi.mocked(exportPlan).mockResolvedValue(
      plan([
        { shotCode: 'SH010', duration: 4, storageKey: 'media/1.mov' },
        { shotCode: 'SH020', duration: 6, storageKey: 'media/2.mov' },
      ]),
    );

    const progress = await runJob();

    expect(vi.mocked(storage.downloadToFile)).toHaveBeenCalledTimes(2);
    // Deux encodages de segment + une concaténation.
    expect(ffmpegCalls).toHaveLength(3);
    expect(vi.mocked(storage.uploadFile)).toHaveBeenCalledWith(
      masterKey(7),
      expect.stringContaining('master.mp4'),
      'video/mp4',
    );
    // La progression finit à 100 : un export terminé ne reste pas coincé à 90 %.
    expect(progress.at(-1)).toBe(100);
  });

  it('remplace un plan sans média par un carton : le master dure ce que dure la timeline', async () => {
    vi.mocked(exportPlan).mockResolvedValue(
      plan([
        { shotCode: 'SH010', duration: 4, storageKey: 'media/1.mov' },
        { shotCode: 'SH020', duration: 6, storageKey: null },
      ]),
    );

    await runJob();

    // Le plan manquant n'est pas sauté : il passe par le device lavfi, avec son code.
    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0]).toContain('lavfi');
    expect(spawnCalls[0]?.join(' ')).toContain('SH020');
    expect(vi.mocked(storage.downloadToFile)).toHaveBeenCalledTimes(1);
  });

  it('refait le carton sans texte quand drawtext échoue, plutôt que de perdre l’export', async () => {
    vi.mocked(exportPlan).mockResolvedValue(plan([{ shotCode: 'SH030', duration: 2, storageKey: null }]));
    // Première tentative refusée (police absente), seconde acceptée.
    spawnExitCodes.push(1, 0);

    await runJob();

    expect(spawnCalls).toHaveLength(2);
    // Le second appel n'incruste plus de texte.
    expect(spawnCalls[0]).toContain('-vf');
    expect(spawnCalls[1]).not.toContain('-vf');
    expect(vi.mocked(logger.warn)).toHaveBeenCalled();
    expect(vi.mocked(storage.uploadFile)).toHaveBeenCalledTimes(1);
  });

  it('refuse un montage vide au lieu de déposer un fichier de zéro seconde', async () => {
    vi.mocked(exportPlan).mockResolvedValue(plan([]));
    await expect(runJob()).rejects.toThrow(/no shot to export/);
    expect(vi.mocked(storage.uploadFile)).not.toHaveBeenCalled();
  });

  it('efface son répertoire temporaire même quand ffmpeg échoue', async () => {
    vi.mocked(exportPlan).mockResolvedValue(
      plan([{ shotCode: 'SH040', duration: 3, storageKey: 'media/3.mov' }]),
    );
    ffmpegError = new Error('ffmpeg exploded');

    await expect(runJob()).rejects.toThrow(/ffmpeg exploded/);
    // Le `finally` du worker : sans lui, chaque échec laisserait un montage entier sur disque.
    expect(removed.some((p) => p.includes('review-timeline-'))).toBe(true);
  });
});
