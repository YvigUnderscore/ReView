// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { pinoHttp } from 'pino-http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { httpLoggerOptions, isProbeRequest } from './httpLogger';

/**
 * INFRA-11 — le coût se mesure en NOMBRE DE LIGNES, pas en secondes.
 *
 * Le healthcheck docker interroge `/health` toutes les 10 s et Prometheus `/metrics`
 * toutes les 15 s : ~14 400 lignes par jour, sur un budget de rotation de 50 Mo par
 * conteneur. L'exploitant qui enquête le lendemain sur l'incident de la veille ne remonte
 * plus assez loin. Ce qui suit compte les lignes réellement émises par la configuration de
 * production, à travers un vrai serveur HTTP — pas une simulation d'objets req/res.
 */

/** Lignes émises par pino, une par enregistrement. */
const lines: string[] = [];

/** Dernière ligne écrite — `lines.at(-1)` est `string | undefined`, ce que les tests ne veulent pas. */
function lastLine(): string {
  const last = lines.at(-1);
  if (last === undefined) throw new Error('aucune ligne journalisée');
  return last;
}

const middleware = pinoHttp(
  // La configuration de production, avec le seul niveau forcé à `info` : le logger de
  // l'application est `silent` en test, ce qui rendrait tout comptage vide et donc vert.
  { ...httpLoggerOptions, level: 'info' },
  {
    write(line: string) {
      lines.push(line);
    },
  },
);

let server: Server;
let base = '';

beforeAll(async () => {
  server = createServer((req, res) => {
    middleware(req, res);
    // `?status=500` permet de vérifier que l'échec d'une sonde, lui, reste journalisé.
    const status = Number(new URL(req.url ?? '/', 'http://x').searchParams.get('status') ?? 200);
    res.statusCode = status;
    res.end('ok');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** Rejoue `count` requêtes et rend le nombre de lignes de journal qu'elles ont produites. */
async function countLines(path: string, count: number): Promise<number> {
  const before = lines.length;
  for (let i = 0; i < count; i += 1) {
    const response = await fetch(`${base}${path}`);
    await response.text();
  }
  return lines.length - before;
}

describe('isProbeRequest — frontière entre sonde et trafic', () => {
  it('reconnaît les sondes, sous /api comme hors /api', () => {
    for (const url of [
      '/health',
      '/health/live',
      '/health/ready',
      '/api/health',
      '/api/health/ready',
      '/metrics',
      '/health/',
    ]) {
      expect(isProbeRequest(url), url).toBe(true);
    }
  });

  it('reconnaît /metrics même quand Prometheus porte son jeton en query', () => {
    // C'est le cas dès que METRICS_TOKEN est posé : une comparaison sur l'URL entière
    // (`req.url === '/metrics'`) laisserait repasser tout le bruit du scrape.
    expect(isProbeRequest('/metrics?token=s3cr3t')).toBe(true);
  });

  it("ne silencie aucune route de l'application", () => {
    for (const url of [
      '/api/media/1',
      '/api/health-checks',
      '/healthy',
      '/metricsX',
      '/api/projects/7/media?limit=50',
      undefined,
    ]) {
      expect(isProbeRequest(url), String(url)).toBe(false);
    }
  });
});

describe('httpLogger — volume de journal des sondes automatiques', () => {
  it("n'écrit aucune ligne pour trente passages du healthcheck", async () => {
    // Trente passages = cinq minutes de sonde docker. Sans le correctif : 30 lignes.
    expect(await countLines('/health', 30)).toBe(0);
  });

  it("n'écrit aucune ligne pour vingt scrapes Prometheus, jeton compris", async () => {
    expect(await countLines('/metrics?token=s3cr3t', 20)).toBe(0);
  });

  it('journalise en revanche chaque requête applicative', async () => {
    // Contre-preuve : le silence est ciblé, la journalisation HTTP n'est pas éteinte.
    expect(await countLines('/api/media/1', 20)).toBe(20);
  });

  it("journalise l'ÉCHEC d'une sonde, qui est ce qu'on vient chercher dans le journal", async () => {
    expect(await countLines('/health?status=500', 1)).toBe(1);
    expect(JSON.parse(lastLine()).level).toBe(50);

    expect(await countLines('/health/ready?status=503', 1)).toBe(1);
    expect(JSON.parse(lastLine()).level).toBe(50);

    // 4xx : la sonde interroge une route qui n'existe pas — anomalie de configuration.
    expect(await countLines('/metrics?status=404', 1)).toBe(1);
    expect(JSON.parse(lastLine()).level).toBe(40);
  });

  it('masque toujours les secrets des lignes qui subsistent', async () => {
    await countLines('/metrics?token=s3cr3t&status=500', 1);
    const record = JSON.parse(lastLine()) as { req: { url: string } };
    expect(record.req.url).toBe('/metrics?token=[Redacted]&status=500');
  });
});
