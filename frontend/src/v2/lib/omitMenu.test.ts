// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { isOmitted, omitBody, sequenceIdOf } from './omitMenu';

describe('isOmitted', () => {
  it('reads the shot flag', () => {
    expect(isOmitted({ id: 1, omitted: true })).toBe(true);
    expect(isOmitted({ id: 1, omitted: false })).toBe(false);
  });

  it('treats a shot without a flag as a shot in the mount', () => {
    // A screen that does not request the field must not display the box as ticked.
    expect(isOmitted({ id: 1 })).toBe(false);
  });
});

describe('omitBody', () => {
  it('toggles the flag in both directions', () => {
    expect(omitBody({ id: 1 })).toEqual({ omitted: true });
    expect(omitBody({ id: 1, omitted: true })).toEqual({ omitted: false });
  });

  it('sends only the flag', () => {
    // The rest of the shot is edited elsewhere: attaching an untouched field would republish it to
    // ShotGrid over a value that may have moved in the meantime.
    const body = omitBody({ id: 1, omitted: false, sequenceId: 7 });
    expect(Object.keys(body)).toEqual(['omitted']);
  });
});

describe('sequenceIdOf', () => {
  it('reads the sequence flat, as a project list provides it', () => {
    expect(sequenceIdOf({ id: 1, sequenceId: 7 })).toBe(7);
  });

  it('reads the nested sequence, as a shot record provides it', () => {
    expect(sequenceIdOf({ id: 1, sequence: { id: 7 } })).toBe(7);
  });

  it('returns null for a shot outside any sequence, whatever the shape', () => {
    expect(sequenceIdOf({ id: 1, sequenceId: null })).toBeNull();
    expect(sequenceIdOf({ id: 1, sequence: null })).toBeNull();
    expect(sequenceIdOf({ id: 1 })).toBeNull();
  });
});
