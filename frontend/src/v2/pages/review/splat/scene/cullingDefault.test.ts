// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CULLING_OFF, parseCullingOff, readCullingOff, writeCullingOff } from './cullingDefault';

describe('culling default', () => {
  it('is ACTIVE: `off` is false when no preference is saved', () => {
    // Lot 8: culling had been disabled since 10.G-V1. This test records the change.
    expect(DEFAULT_CULLING_OFF).toBe(false);
  });
});

describe('parseCullingOff', () => {
  it('reads both written values', () => {
    expect(parseCullingOff('1')).toBe(true);
    expect(parseCullingOff('0')).toBe(false);
  });

  it('falls back to the default for a missing or unreadable value', () => {
    expect(parseCullingOff(null)).toBe(DEFAULT_CULLING_OFF);
    expect(parseCullingOff('')).toBe(DEFAULT_CULLING_OFF);
    expect(parseCullingOff('true')).toBe(DEFAULT_CULLING_OFF);
  });
});

describe('per-user memory', () => {
  beforeEach(() => localStorage.clear());

  it('reads back what was written: the scene and the dock toggle read the same value', () => {
    expect(readCullingOff()).toBe(DEFAULT_CULLING_OFF);
    writeCullingOff(true);
    expect(readCullingOff()).toBe(true);
    writeCullingOff(false);
    expect(readCullingOff()).toBe(false);
  });
});
