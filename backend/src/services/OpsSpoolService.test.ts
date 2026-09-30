// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { config } = vi.hoisted(() => ({
  config: { queue: undefined as string | undefined, state: undefined as string | undefined, stale: 90 },
}));
vi.mock('../config/env', () => ({
  env: {
    get OPS_QUEUE_DIR() {
      return config.queue;
    },
    get OPS_STATE_DIR() {
      return config.state;
    },
    get OPS_AGENT_STALE_SEC() {
      return config.stale;
    },
  },
}));
vi.mock('../lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { buildOrder } from '../lib/opsOrder';
import {
  activeRun,
  cancel,
  enqueue,
  isTerminal,
  listRuns,
  mechanism,
  readLog,
  readRun,
} from './OpsSpoolService';

const ID = '20260910-142233-a1b2c3';

/** Un spool tel que l'agent le laisse : file d'un côté, état de l'autre. */
function spool(): { queue: string; state: string } {
  const root = mkdtempSync(join(tmpdir(), 'review-ops-'));
  const queue = join(root, 'queue');
  const state = join(root, 'state');
  mkdirSync(queue);
  mkdirSync(join(state, 'runs'), { recursive: true });
  config.queue = queue;
  config.state = state;
  return { queue, state };
}

const agentFile = (state: string, extra: Record<string, unknown> = {}) =>
  writeFileSync(
    join(state, 'agent.json'),
    JSON.stringify({
      protocol: 1,
      version: '2.4.0',
      seenAt: new Date().toISOString(),
      rootOk: true,
      pollSec: 2,
      allow: { update: true, backup: true, verify: true },
      ...extra,
    }),
  );

const statusFile = (state: string, id: string, extra: Record<string, unknown> = {}) => {
  mkdirSync(join(state, 'runs', id), { recursive: true });
  writeFileSync(
    join(state, 'runs', id, 'status.json'),
    JSON.stringify({
      protocol: 1,
      id,
      kind: 'update',
      target: 'v2.4.0',
      state: 'running',
      phase: 'backup',
      heartbeatAt: new Date().toISOString(),
      ...extra,
    }),
  );
};

const order = buildOrder({
  id: ID,
  kind: 'update',
  now: new Date('2026-09-10T14:22:33Z'),
  ttlSec: 900,
  actor: { id: 3, displayName: 'ops@studio.tld' },
  version: 'v2.4.0',
});

beforeEach(() => {
  config.queue = undefined;
  config.state = undefined;
  config.stale = 90;
});

describe('mechanism', () => {
  it('dit « absent » quand l’exécution n’est pas branchée', async () => {
    await expect(mechanism()).resolves.toMatchObject({ state: 'absent', reason: 'SPOOL_UNSET' });
  });

  it('dit « absent » quand l’agent n’a jamais écrit son état', async () => {
    spool();
    await expect(mechanism()).resolves.toMatchObject({ state: 'absent', reason: 'AGENT_NEVER_SEEN' });
  });

  it('dit « prêt » quand l’agent bat et que rien ne tourne', async () => {
    const { state } = spool();
    agentFile(state);
    await expect(mechanism()).resolves.toMatchObject({ state: 'ready', agentVersion: '2.4.0' });
  });

  it('dit « muet » quand le battement date', async () => {
    const { state } = spool();
    agentFile(state, { seenAt: new Date(Date.now() - 600_000).toISOString() });
    await expect(mechanism()).resolves.toMatchObject({ state: 'stalled', reason: 'AGENT_STALE' });
  });

  it('bloque tout quand le dépôt n’est pas monté sur son chemin hôte', async () => {
    // `backup.sh` écrirait alors son miroir dans le vide, sans une erreur : on ne s'en
    // apercevrait que le jour de la restauration.
    const { state } = spool();
    agentFile(state, { rootOk: false });
    await expect(mechanism()).resolves.toMatchObject({ state: 'blocked', reason: 'ROOT_MISMATCH' });
  });

  it('bloque tout quand l’agent parle un protocole plus récent que le nôtre', async () => {
    const { state } = spool();
    agentFile(state, { protocol: 99 });
    await expect(mechanism()).resolves.toMatchObject({ state: 'blocked', reason: 'PROTOCOL_UNSUPPORTED' });
  });

  it('dit « occupé » tant qu’une opération tourne', async () => {
    const { state } = spool();
    agentFile(state);
    statusFile(state, ID);
    await expect(mechanism()).resolves.toMatchObject({ state: 'busy' });
  });

  it('reste debout devant un état illisible', async () => {
    const { state } = spool();
    writeFileSync(join(state, 'agent.json'), '{ ceci n’est pas du JSON');
    await expect(mechanism()).resolves.toMatchObject({ state: 'absent' });
  });
});

describe('enqueue', () => {
  it('écrit l’ordre dans la file, et seulement là', async () => {
    const { queue, state } = spool();
    await enqueue(order);
    expect(readdirSync(queue)).toEqual([`${ID}.json`]);
    // L'état appartient à l'agent : c'est cette asymétrie qui empêche un backend compromis
    // d'y poser un lien symbolique que l'agent suivrait ensuite en écriture.
    expect(readdirSync(join(state, 'runs'))).toEqual([]);
    expect(JSON.parse(readFileSync(join(queue, `${ID}.json`), 'utf8'))).toMatchObject({
      id: ID,
      kind: 'update',
    });
  });

  it('ne laisse aucun fichier temporaire derrière lui', async () => {
    const { queue } = spool();
    await enqueue(order);
    expect(readdirSync(queue).filter((n) => n.endsWith('.tmp'))).toEqual([]);
  });

  it('refuse d’écrire quand l’exécution n’est pas branchée', async () => {
    await expect(enqueue(order)).rejects.toThrow();
  });
});

describe('listRuns et activeRun', () => {
  it('réunit les ordres en attente et les exécutions connues, la plus récente en tête', async () => {
    const { state } = spool();
    await enqueue(order);
    statusFile(state, '20260909-100000-000001', { state: 'succeeded', phase: 'done', endedAt: 'x' });
    const runs = await listRuns();
    expect(runs.map((r) => r.id)).toEqual([ID, '20260909-100000-000001']);
    // L'ordre est relu : entre le clic et le ramassage par l'agent, l'écran doit dire de
    // QUOI il s'agit — pas « opération inconnue » à la personne qui vient de la lancer.
    expect(runs[0]).toMatchObject({
      state: 'queued',
      kind: 'update',
      target: 'v2.4.0',
      requestedBy: { id: 3, displayName: 'ops@studio.tld' },
    });
  });

  it('tient pour « sans nouvelles » une exécution dont l’agent ne bat plus', async () => {
    // Sans cette règle, l'écran afficherait une progression éternelle pour un agent mort.
    const { state } = spool();
    statusFile(state, ID, { heartbeatAt: new Date(Date.now() - 600_000).toISOString() });
    await expect(readRun(ID)).resolves.toMatchObject({ state: 'unknown' });
    await expect(activeRun()).resolves.toBeNull();
  });

  it('ne laisse annuler que tant que rien n’est basculé', async () => {
    const { state } = spool();
    statusFile(state, ID, { phase: 'backup' });
    expect((await readRun(ID))?.cancellable).toBe(true);
    statusFile(state, ID, { phase: 'switch' });
    expect((await readRun(ID))?.cancellable).toBe(false);
  });

  it('refuse un identifiant qui n’en est pas un', async () => {
    spool();
    await expect(readRun('../../etc')).resolves.toBeNull();
    await expect(cancel('../../etc')).rejects.toThrow();
  });

  it('dépose la sentinelle d’annulation dans la file, jamais dans l’état', async () => {
    const { queue, state } = spool();
    await cancel(ID);
    expect(readdirSync(queue)).toEqual([`${ID}.cancel`]);
    expect(readdirSync(join(state, 'runs'))).toEqual([]);
  });
});

describe('readLog', () => {
  it('sert le journal par décalage d’octets — c’est ce qui survit à un redémarrage', async () => {
    const { state } = spool();
    mkdirSync(join(state, 'runs', ID), { recursive: true });
    writeFileSync(join(state, 'runs', ID, 'output.log'), 'première ligne\n');

    const first = await readLog(ID, 0);
    expect(first.text).toBe('première ligne\n');
    expect(first.truncated).toBe(false);

    // Le fichier n'est écrit qu'en ajout : reprendre au curseur donne exactement la suite.
    writeFileSync(join(state, 'runs', ID, 'output.log'), 'première ligne\nseconde ligne\n');
    const second = await readLog(ID, first.next);
    expect(second.text).toBe('seconde ligne\n');
    expect(second.from).toBe(first.next);
  });

  it('caviarde les secrets avant de servir', async () => {
    const { state } = spool();
    mkdirSync(join(state, 'runs', ID), { recursive: true });
    writeFileSync(join(state, 'runs', ID, 'output.log'), 'url=postgresql://review:hunter2222@db:5432/x\n');
    expect((await readLog(ID, 0)).text).not.toContain('hunter2222');
  });

  it('rend un journal vide plutôt qu’une erreur quand il n’y en a pas', async () => {
    spool();
    await expect(readLog(ID, 0)).resolves.toMatchObject({ text: '', next: 0 });
  });
});

describe('isTerminal', () => {
  it('distingue ce qui bougera encore de ce qui est joué', () => {
    for (const state of ['queued', 'running'] as const) expect(isTerminal(state), state).toBe(false);
    for (const state of [
      'succeeded',
      'rolled-back',
      'failed',
      'cancelled',
      'expired',
      'rejected',
      'unknown',
    ] as const) {
      expect(isTerminal(state), state).toBe(true);
    }
  });
});
