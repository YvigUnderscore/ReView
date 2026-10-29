// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { projectRoleInfo } from './useProjectRole';

describe('projectRoleInfo', () => {
  it('gives the project supervisor the rights the server grants them', () => {
    // The missing case: global role ARTIST, supervisor by membership. The screen
    // refused what the API accepted.
    expect(projectRoleInfo('ARTIST', 'SUPERVISOR')).toEqual({
      role: 'SUPERVISOR',
      canManage: true,
      canContribute: true,
    });
  });

  it('takes nothing away from a studio admin, member or not', () => {
    expect(projectRoleInfo('ADMIN', null).canManage).toBe(true);
    expect(projectRoleInfo('ADMIN', 'CLIENT').canManage).toBe(true);
  });

  it('falls back to the global role until the request answers', () => {
    expect(projectRoleInfo('SUPERVISOR', null).canManage).toBe(true);
    expect(projectRoleInfo('ARTIST', null).canManage).toBe(false);
  });

  it('closes contribution to client accounts', () => {
    expect(projectRoleInfo('CLIENT', null)).toEqual({
      role: 'CLIENT',
      canManage: false,
      canContribute: false,
    });
    expect(projectRoleInfo('ARTIST', 'CLIENT').canContribute).toBe(false);
  });

  it('concludes nothing without a loaded account', () => {
    expect(projectRoleInfo(undefined, null)).toEqual({
      role: null,
      canManage: false,
      canContribute: false,
    });
  });
});
