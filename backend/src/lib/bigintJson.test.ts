// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import './bigintJson';

describe('bigintJson', () => {
  it('renders BigInt serialisable by JSON.stringify', () => {
    expect(JSON.stringify(42n)).toBe('42');
  });
  it('serialises nested BigInt columns (e.g. file size)', () => {
    expect(JSON.stringify({ size: 1024n })).toBe('{"size":1024}');
  });
});
