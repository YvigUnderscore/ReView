// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./logger', () => ({ logger: { warn: vi.fn(), debug: vi.fn() } }));

import { logger } from './logger';
import { ignoreFailure } from './ignoreFailure';

describe('ignoreFailure', () => {
  beforeEach(() => vi.clearAllMocks());

  it('keeps fire-and-forget semantics: the rejection resolves to undefined', async () => {
    await expect(
      Promise.reject(new Error('minio down')).catch(ignoreFailure('cleanup failed')),
    ).resolves.toBe(undefined);
  });

  it('logs a warning with the call-site context and the error', async () => {
    const err = new Error('minio down');
    await Promise.reject(err).catch(ignoreFailure('storage cleanup failed', { key: 'a/b' }));
    expect(logger.warn).toHaveBeenCalledWith({ err, key: 'a/b' }, 'storage cleanup failed');
  });

  it('a record already gone (P2025) is only a debug trace', async () => {
    const err = Object.assign(new Error('gone'), { code: 'P2025' });
    await Promise.reject(err).catch(ignoreFailure('delete failed'));
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledWith({ err }, 'delete failed');
  });

  it('tolerates non-error rejections', async () => {
    expect(ignoreFailure('x')(null)).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith({ err: null }, 'x');
  });

  it('an expected failure can be demoted to debug', () => {
    ignoreFailure('refused', { id: 1 }, 'debug')(new Error('locked'));
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledTimes(1);
  });
});
