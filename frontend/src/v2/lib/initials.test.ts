// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { initialsFrom } from './initials';

describe('initialsFrom', () => {
  it('prend la première lettre de chaque mot', () => {
    expect(initialsFrom('Ada Lovelace')).toBe('AL');
  });

  it('se contente d’une lettre pour un prénom seul', () => {
    expect(initialsFrom('ada')).toBe('A');
  });

  it('rend un repère lisible plutôt que rien quand le nom manque', () => {
    expect(initialsFrom(null)).toBe('?');
    expect(initialsFrom('')).toBe('?');
  });
});
