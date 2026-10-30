// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi } from 'vitest';
import { logger, prettyTransport } from './logger';

describe('logger', () => {
  it('exposes a pino instance with the usual level methods', () => {
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.child).toBe('function');
  });

  it('is silent in test environment (NODE_ENV=test, no noise in the suite)', () => {
    // Level derivation: test → silent (cf. lib/logger.ts).
    expect(logger.level).toBe('silent');
  });
});

/**
 * On 2026-09-17, the development docker stack no longer started: the runtime image is built without
 * devDependencies (`npm ci --omit=dev`) and the dev override sets `NODE_ENV=development` there. pino then required
 * `pino-pretty`, which was absent, and threw AT MODULE LOAD — the container died before the first log line, on a
 * message that said nothing about docker or NODE_ENV.
 */
describe('prettyTransport — the pretty-printer cannot prevent a start', () => {
  const installed = () => true;
  const absent = () => false;

  it('pretty-prints in development when the package is there', () => {
    expect(prettyTransport('development', installed)).toMatchObject({ target: 'pino-pretty' });
  });

  it('falls back to JSON when the package is missing, instead of throwing', () => {
    expect(prettyTransport('development', absent)).toBeUndefined();
  });

  it('never asks for the pretty-printer outside development', () => {
    for (const env of ['production', 'test']) {
      expect(prettyTransport(env, installed)).toBeUndefined();
    }
  });

  // Outside development, we must not even pay for resolving the module.
  it('does not look for the package when the environment does not call for it', () => {
    const probe = vi.fn(() => true);
    prettyTransport('production', probe);
    expect(probe).not.toHaveBeenCalled();
  });
});
