// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { WEBHOOK_EVENTS } from './webhooks';
import { EMITTED_WEBHOOK_EVENTS, PHANTOM_WEBHOOK_EVENTS, isEmittedWebhookEvent } from './webhookCatalog';

/**
 * Le catalogue ne doit pas mentir. Un administrateur qui coche un événement attend un
 * appel : s'abonner à `shot.created` pour ne jamais rien recevoir est pire que ne pas
 * pouvoir s'y abonner du tout — il croit son alerte branchée.
 *
 * Ces tests relisent les sources plutôt que de faire confiance à une liste : c'est la
 * seule façon d'attraper l'écart le jour où quelqu'un ajoute un nom au catalogue sans
 * l'émettre, ou câble enfin un fantôme sans le sortir de sa liste.
 */

const SRC = join(__dirname, '..');
/** Fichiers qui parlent DU catalogue plutôt que d'émettre : ils ne comptent pas. */
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

describe('catalogue des événements de webhook', () => {
  it('partitionne le catalogue : émis + fantômes = tout, sans recouvrement', () => {
    expect([...EMITTED_WEBHOOK_EVENTS, ...PHANTOM_WEBHOOK_EVENTS].sort()).toEqual([...WEBHOOK_EVENTS].sort());
    expect(PHANTOM_WEBHOOK_EVENTS.filter((e) => isEmittedWebhookEvent(e))).toEqual([]);
  });

  it('chaque événement proposé à l’abonnement existe bien dans le code', () => {
    const missing = EMITTED_WEBHOOK_EVENTS.filter((e) => !isPublished(e));
    expect(missing).toEqual([]);
  });

  it('aucun fantôme n’est publié quelque part (sinon le déplacer dans la liste émise)', () => {
    const wired = PHANTOM_WEBHOOK_EVENTS.filter((e) => isPublished(e));
    expect(wired).toEqual([]);
  });

  it('reconnaît un événement émis et refuse un fantôme', () => {
    expect(isEmittedWebhookEvent('version.published')).toBe(true);
    expect(isEmittedWebhookEvent('shot.created')).toBe(false);
    expect(isEmittedWebhookEvent('inconnu')).toBe(false);
  });
});
