// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { canEditVersionTransform } from './versionPermissions';

/**
 * Truth table of the right to edit a version's transform. It has a visible consequence: the 3D
 * viewer only shows the "Clean" mode when this predicate is true. The screen previously answered
 * "unpublished + internal role", which offered the "Save" button to an artist who was not the
 * author, and that `VersionService.update` refuses with a 403.
 */

const AUTHOR = 7;
const OTHER = 8;

describe('canEditVersionTransform', () => {
  it('grants editing to the author of an unpublished version', () => {
    expect(canEditVersionTransform({ authorId: AUTHOR, published: false }, AUTHOR, false)).toBe(true);
  });

  it('grants it to the project manager, even if not the author', () => {
    expect(canEditVersionTransform({ authorId: AUTHOR, published: false }, OTHER, true)).toBe(true);
  });

  it('refuses it to an internal member who is neither author nor manager', () => {
    // This is exactly the case that produced the dead button: the service answers 403.
    expect(canEditVersionTransform({ authorId: AUTHOR, published: false }, OTHER, false)).toBe(false);
  });

  it('refuses it as soon as the version is published, author and manager included', () => {
    // Publication lock (`assertWritable(version, 'versionTransform')`): the transform is the basis
    // of the A/B and of the annotations anchored to the frame.
    expect(canEditVersionTransform({ authorId: AUTHOR, published: true }, AUTHOR, false)).toBe(false);
    expect(canEditVersionTransform({ authorId: AUTHOR, published: true }, OTHER, true)).toBe(false);
  });

  it('refuses it when the version has no known author and the caller does not manage the project', () => {
    // `authorId` nullable: a deleted account leaves the version orphaned. Nobody becomes author
    // by default: only a manager keeps control.
    expect(canEditVersionTransform({ authorId: null, published: false }, OTHER, false)).toBe(false);
    expect(canEditVersionTransform({ authorId: null, published: false }, OTHER, true)).toBe(true);
  });
});
