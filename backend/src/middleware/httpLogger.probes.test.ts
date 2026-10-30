// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { pinoHttp } from 'pino-http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { httpLoggerOptions, isProbeRequest } from './httpLogger';

/**
 * INFRA-11: the cost is measured in NUMBER OF LINES, not in seconds.
 *
 * The docker healthcheck polls `/health` every 10 s and Prometheus polls `/metrics` every 15 s:
 * about 14,400 lines per day, against a rotation budget of 50 MB per container. The operator who
 * investigates yesterday's incident the next day can no longer reach back far enough. What follows
 * counts the lines actually emitted by the production configuration, through a real HTTP server,
 * not a simulation of req/res objects.
 */

/** Lines emitted by pino, one per record. */
const lines: string[] = [];

/** Last line written: `lines.at(-1)` is `string | undefined`, which the tests do not want. */
function lastLine(): string {
  const last = lines.at(-1);
  if (last === undefined) throw new Error('aucune ligne journalisée');
  return last;
}

const middleware = pinoHttp(
  // The production configuration, with only the level forced to `info`: the application's logger
  // is `silent` in tests, which would make any count empty and therefore green.
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
    // `?status=500` checks that a probe's failure, for its part, stays logged.
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

/** Replays `count` requests and returns the number of log lines they produced. */
async function countLines(path: string, count: number): Promise<number> {
  const before = lines.length;
  for (let i = 0; i < count; i += 1) {
    const response = await fetch(`${base}${path}`);
    await response.text();
  }
  return lines.length - before;
}

describe('isProbeRequest — boundary between probe and traffic', () => {
  it('recognizes probes, under /api as well as outside it', () => {
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

  it('recognizes /metrics even when Prometheus carries its token in the query', () => {
    // This is the case as soon as METRICS_TOKEN is set: a comparison on the whole URL
    // (`req.url === '/metrics'`) would let all of the scrape noise through.
    expect(isProbeRequest('/metrics?token=s3cr3t')).toBe(true);
  });

  it('silences no application route', () => {
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

describe('httpLogger — log volume of automatic probes', () => {
  it('writes no line for thirty healthcheck passes', async () => {
    // Thirty passes = five minutes of docker probing. Without the fix: 30 lines.
    expect(await countLines('/health', 30)).toBe(0);
  });

  it('writes no line for twenty Prometheus scrapes, token included', async () => {
    expect(await countLines('/metrics?token=s3cr3t', 20)).toBe(0);
  });

  it('logs every application request instead', async () => {
    // Counter-proof: the silence is targeted, HTTP logging is not switched off.
    expect(await countLines('/api/media/1', 20)).toBe(20);
  });

  it("logs a probe's FAILURE, which is what one comes to the log for", async () => {
    expect(await countLines('/health?status=500', 1)).toBe(1);
    expect(JSON.parse(lastLine()).level).toBe(50);

    expect(await countLines('/health/ready?status=503', 1)).toBe(1);
    expect(JSON.parse(lastLine()).level).toBe(50);

    // 4xx: the probe queries a route that does not exist, a configuration anomaly.
    expect(await countLines('/metrics?status=404', 1)).toBe(1);
    expect(JSON.parse(lastLine()).level).toBe(40);
  });

  it('still masks the secrets in the lines that remain', async () => {
    await countLines('/metrics?token=s3cr3t&status=500', 1);
    const record = JSON.parse(lastLine()) as { req: { url: string } };
    expect(record.req.url).toBe('/metrics?token=[Redacted]&status=500');
  });
});
