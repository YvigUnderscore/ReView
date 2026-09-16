// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Entretien périodique — ce qui est enchaîné, et dans quel ordre.
 *
 * Le worker n'exporte rien de pur : on capture le processeur qu'il confie à BullMQ et on
 * l'appelle directement, toutes les purges doublées. Ce qui est vérifié est le **branchement**
 * — la réconciliation des médias figés ne vivait que dans le démarrage du process API, alors
 * que le process qui se fait tuer est le worker : elle ne repassait donc jamais.
 */

type Processor = (job: { data: { kind: string } }) => Promise<void>;

const captured = vi.hoisted((): { processor?: Processor } => ({}));
const steps = vi.hoisted(() => ({ order: [] as string[] }));

const step = <T>(name: string, value: T) =>
  vi.fn(async () => {
    steps.order.push(name);
    return Promise.resolve(value);
  });

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
}));

vi.mock('../lib/redis', () => ({ redisConnectionOptions: {} }));
vi.mock('../services/JobService', () => ({ QUEUE_NAMES: { MAINTENANCE: 'maintenance' } }));
vi.mock('../lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../lib/settings', () => ({
  getNumericSetting: vi.fn(() => Promise.resolve(30)),
  SETTING_KEYS: { TRASH_RETENTION_DAYS: 'trashRetentionDays' },
}));
vi.mock('./shutdown', () => ({ registerWorkerShutdown: vi.fn() }));

const purges = vi.hoisted(() => ({
  trash: vi.fn(),
  derived: vi.fn(),
  uploads: vi.fn(),
  idempotency: vi.fn(),
  retention: vi.fn(),
  reconcile: vi.fn(),
  digests: vi.fn(),
  weekly: vi.fn(),
}));

vi.mock('../lib/trash', () => ({ purgeExpiredTrash: purges.trash }));
vi.mock('../lib/derivedPurge', () => ({ purgeObsoleteDerived: purges.derived }));
vi.mock('../lib/staleUploads', () => ({ purgeStaleUploads: purges.uploads }));
vi.mock('../lib/idempotency', () => ({ purgeIdempotencyRecords: purges.idempotency }));
vi.mock('../lib/retention', () => ({ sweepRetention: purges.retention }));
vi.mock('../lib/mediaReconcile', () => ({ reconcileStuckMedia: purges.reconcile }));
vi.mock('../services/DigestService', () => ({ sendDailyDigests: purges.digests }));
vi.mock('../services/WeeklyReportService', () => ({ sendWeeklyReports: purges.weekly }));

import './maintenance.worker';

beforeEach(() => {
  vi.clearAllMocks();
  steps.order.length = 0;
  purges.trash.mockImplementation(step('trash', 0));
  purges.derived.mockImplementation(step('derived', undefined));
  purges.uploads.mockImplementation(step('uploads', { purged: 0 }));
  purges.idempotency.mockImplementation(step('idempotency', 0));
  purges.retention.mockImplementation(step('retention', undefined));
  purges.reconcile.mockImplementation(step('reconcile', 0));
  purges.digests.mockImplementation(step('digests', 0));
  purges.weekly.mockImplementation(step('weekly', 0));
});

describe('maintenance.worker — passe de purge', () => {
  it('réconcilie les médias figés à chaque passe, après les purges', async () => {
    await captured.processor?.({ data: { kind: 'purge' } });
    expect(purges.reconcile).toHaveBeenCalledTimes(1);
    expect(steps.order).toEqual(['trash', 'derived', 'uploads', 'idempotency', 'retention', 'reconcile']);
  });

  it('ne réconcilie pas depuis les rendez-vous d’envoi', async () => {
    await captured.processor?.({ data: { kind: 'daily-digest' } });
    await captured.processor?.({ data: { kind: 'weekly-report' } });
    expect(purges.reconcile).not.toHaveBeenCalled();
    expect(steps.order).toEqual(['digests', 'weekly']);
  });
});
