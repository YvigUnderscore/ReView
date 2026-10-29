// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { WEBHOOK_EVENTS } from './webhooks';
import { EMITTED_WEBHOOK_EVENTS, PHANTOM_WEBHOOK_EVENTS, isEmittedWebhookEvent } from './webhookCatalog';

/**
 * The catalog must not lie. An administrator who ticks an event expects a call: subscribing to
 * `shot.created` and never receiving anything is worse than not being able to subscribe at all,
 * since they believe their alert is wired up.
 *
 * These tests re-read the sources rather than trust a list: it is the only way to catch the gap on
 * the day someone adds a name to the catalog without emitting it, or finally wires up a phantom
 * without removing it from its list.
 */

const SRC = join(__dirname, '..');
/** Files that talk ABOUT the catalog rather than emit: they do not count. */
const IGNORED = new Set(['webhooks.ts', 'webhookCatalog.ts', 'webhookCatalog.test.ts']);

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts') && !IGNORED.has(entry)) out.push(full);
  }
  return out;
}

const corpus = sourceFiles(SRC)
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n');

const isPublished = (event: string) => corpus.includes(`'${event}'`);

describe('webhook event catalog', () => {
  it('partitions the catalog: emitted + phantoms = everything, with no overlap', () => {
    expect([...EMITTED_WEBHOOK_EVENTS, ...PHANTOM_WEBHOOK_EVENTS].sort()).toEqual([...WEBHOOK_EVENTS].sort());
    expect(PHANTOM_WEBHOOK_EVENTS.filter((e) => isEmittedWebhookEvent(e))).toEqual([]);
  });

  it('every event offered for subscription does exist in the code', () => {
    const missing = EMITTED_WEBHOOK_EVENTS.filter((e) => !isPublished(e));
    expect(missing).toEqual([]);
  });

  it('no phantom is published anywhere (otherwise move it to the emitted list)', () => {
    const wired = PHANTOM_WEBHOOK_EVENTS.filter((e) => isPublished(e));
    expect(wired).toEqual([]);
  });

  it('recognizes an emitted event and rejects a phantom', () => {
    expect(isEmittedWebhookEvent('version.published')).toBe(true);
    expect(isEmittedWebhookEvent('shot.created')).toBe(false);
    expect(isEmittedWebhookEvent('inconnu')).toBe(false);
  });
});
