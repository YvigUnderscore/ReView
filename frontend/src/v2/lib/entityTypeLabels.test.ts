// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { t } from '../i18n';
import { assetTypeLabel, taskTypeLabel, titleCase } from './entityTypeLabels';

/**
 * The Assets tab and kanban filters displayed `CHARACTER`, `PROP`, `LOOKDEV` — base identifiers,
 * in capitals, in the middle of an otherwise written interface.
 */
describe('assetTypeLabel', () => {
  it('translates the known types', () => {
    expect(assetTypeLabel(t, 'CHARACTER')).toBe('Character');
    expect(assetTypeLabel(t, 'ENVIRONMENT')).toBe('Environment');
  });

  it('leaves FX as is — it is production vocabulary', () => {
    expect(assetTypeLabel(t, 'FX')).toBe('FX');
  });

  it('falls back to a readable casing for an unknown type, never to the key', () => {
    expect(assetTypeLabel(t, 'MATTE_PAINTING')).toBe('Matte Painting');
    expect(assetTypeLabel(t, 'MACHIN')).not.toContain('assetType.');
  });
});

describe('taskTypeLabel', () => {
  it('keeps the department vocabulary, in normal casing', () => {
    expect(taskTypeLabel(t, 'LOOKDEV')).toBe('Look Dev');
    expect(taskTypeLabel(t, 'COMPOSITING')).toBe('Compositing');
    expect(taskTypeLabel(t, 'FX')).toBe('FX');
  });

  it('stays readable for a type it does not know', () => {
    expect(taskTypeLabel(t, 'MATCHMOVE')).toBe('Matchmove');
  });

  it('translates "Other", which is not a department name', () => {
    expect(taskTypeLabel(t, 'OTHER')).toBe('Other');
  });
});

describe('titleCase', () => {
  it('can read the separators of base identifiers', () => {
    expect(titleCase('LOOK_DEV')).toBe('Look Dev');
    expect(titleCase('matte-painting')).toBe('Matte Painting');
    expect(titleCase('')).toBe('');
  });
});
