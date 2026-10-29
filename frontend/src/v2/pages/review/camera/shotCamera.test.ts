// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { gizmoKeyTime, shouldKeyLens } from './shotCamera';

describe('shouldKeyLens', () => {
  it('inside the camera: only armed auto-key turns an adjustment into a key', () => {
    expect(shouldKeyLens(false, false)).toBe(false);
    expect(shouldKeyLens(false, true)).toBe(true);
  });

  it('outside the camera: always a key — writing to the free camera changed nothing in the plan', () => {
    expect(shouldKeyLens(true, false)).toBe(true);
    expect(shouldKeyLens(true, true)).toBe(true);
  });
});

describe('gizmoKeyTime', () => {
  it('takes over the selected key when the gesture holds one', () => {
    expect(gizmoKeyTime(4200, 1000)).toBe(4200);
  });

  it('writes at the playhead, even on an empty animation (t=0 was forced before)', () => {
    expect(gizmoKeyTime(undefined, 3500)).toBe(3500);
    expect(gizmoKeyTime(undefined, 0)).toBe(0);
  });

  it('rounds and never goes below zero', () => {
    expect(gizmoKeyTime(undefined, 1200.6)).toBe(1201);
    expect(gizmoKeyTime(undefined, -5)).toBe(0);
  });
});
