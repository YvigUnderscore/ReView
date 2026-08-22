// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { envMock } = vi.hoisted(() => ({ envMock: { METRICS_TOKEN: '' } }));
vi.mock('../config/env', () => ({ env: envMock }));
vi.mock('../lib/gracefulShutdown', () => ({
  registerShutdownTask: vi.fn(),
  SHUTDOWN_PHASE: { STOP_INTAKE: 10, DISCONNECT: 20 },
}));

import {
  attachWorkerMetrics,
  jobDurationSec,
  jobKind,
  observeWorkerJob,
  providedToken,
  startWorkerMetricsServer,
  workerRegistry,
} from './metricsServer';
import { registerShutdownTask } from '../lib/gracefulShutdown';

/** Émetteur minimal : le double de `Worker` BullMQ, réduit à ses deux événements. */
function fakeWorker() {
  const listeners = new Map<string, (job: unknown, err?: unknown) => void>();
  return {
    on(event: string, listener: (job: unknown, err?: unknown) => void) {
      listeners.set(event, listener);
      return this;
    },
    emit(event: string, job: unknown) {
      listeners.get(event)?.(job);
    },
  };
}

const servers: { close(): void }[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.close();
  envMock.METRICS_TOKEN = '';
});

describe('jobKind / jobDurationSec', () => {
  it('préfère le type métier du job à son nom de file', () => {
    expect(jobKind({ name: 'process', data: { kind: 'hls' } })).toBe('hls');
    expect(jobKind({ name: 'process' })).toBe('process');
    expect(jobKind(null)).toBe('unknown');
  });

  it('mesure la durée entre prise en charge et fin', () => {
    expect(jobDurationSec({ processedOn: 1_000, finishedOn: 4_000 })).toBe(3);
  });

  it('n’invente pas de durée pour un job jamais pris en charge', () => {
    expect(jobDurationSec({ finishedOn: 4_000 })).toBeNull();
  });

  it('retombe sur l’instant courant quand la fin manque (job calé)', () => {
    expect(jobDurationSec({ processedOn: 1_000 }, 3_000)).toBe(2);
  });
});

describe('attachWorkerMetrics', () => {
  it('compte les réussites et les échecs, avec leur durée', async () => {
    const worker = fakeWorker();
    attachWorkerMetrics('media-test', worker);
    worker.emit('completed', { data: { kind: 'hls' }, processedOn: 0, finishedOn: 12_000 });
    worker.emit('failed', { data: { kind: 'thumbnail' }, processedOn: 0, finishedOn: 1_000 });

    const text = await workerRegistry.metrics();
    expect(text).toContain('review_worker_jobs_total{queue="media-test",kind="hls",outcome="completed"} 1');
    expect(text).toContain(
      'review_worker_jobs_total{queue="media-test",kind="thumbnail",outcome="failed"} 1',
    );
    expect(text).toContain('review_worker_job_duration_seconds_sum{queue="media-test",kind="hls"} 12');
  });

  it('compte un job sans horodatage sans fausser l’histogramme', async () => {
    observeWorkerJob('media-test', 'sans-duree', 'completed', null);
    const text = await workerRegistry.metrics();
    expect(text).toContain('kind="sans-duree",outcome="completed"} 1');
    expect(text).not.toContain('kind="sans-duree"} ');
  });
});

describe('providedToken', () => {
  it('lit le jeton dans l’en-tête puis dans l’URL', () => {
    expect(providedToken('/metrics', 'Bearer abc')).toBe('abc');
    expect(providedToken('/metrics?token=xyz', undefined)).toBe('xyz');
    expect(providedToken('/metrics', undefined)).toBeUndefined();
  });
});

describe('startWorkerMetricsServer', () => {
  /** Port 0 : le noyau choisit un port libre — deux suites en parallèle ne se marchent pas dessus. */
  const start = () => {
    const server = startWorkerMetricsServer(0);
    servers.push(server);
    return new Promise<string>((resolve) => {
      server.on('listening', () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`));
    });
  };

  it('sert le registre du worker sur /metrics, et rien ailleurs', async () => {
    const base = await start();
    const metrics = await fetch(`${base}/metrics`);
    expect(metrics.status).toBe(200);
    const body = await metrics.text();
    expect(body).toContain('review_worker_info');
    // Métriques de process : c'est ce qui rend « le worker est vivant » mesurable.
    expect(body).toContain('process_resident_memory_bytes');

    const other = await fetch(`${base}/`);
    expect(other.status).toBe(404);
  });

  it('exige le jeton quand METRICS_TOKEN est posé', async () => {
    envMock.METRICS_TOKEN = 'jeton-de-test';
    const base = await start();
    expect((await fetch(`${base}/metrics`)).status).toBe(401);
    expect((await fetch(`${base}/metrics?token=mauvais`)).status).toBe(401);
    expect((await fetch(`${base}/metrics?token=jeton-de-test`)).status).toBe(200);
  });

  it('s’éteint avec le process (tâche d’extinction enregistrée)', async () => {
    await start();
    expect(vi.mocked(registerShutdownTask)).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'worker-metrics', phase: 10 }),
    );
  });
});
