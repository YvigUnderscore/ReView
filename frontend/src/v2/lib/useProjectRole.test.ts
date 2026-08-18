// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { projectRoleInfo } from './useProjectRole';

describe('projectRoleInfo', () => {
  it('donne au superviseur de projet les droits que le serveur lui ouvre', () => {
    // Le cas qui manquait : rôle global ARTIST, superviseur par membership. L'écran
    // refusait ce que l'API acceptait.
    expect(projectRoleInfo('ARTIST', 'SUPERVISOR')).toEqual({
      role: 'SUPERVISOR',
      canManage: true,
      canContribute: true,
    });
  });

  it('ne retire rien à un administrateur du studio, membre ou non', () => {
    expect(projectRoleInfo('ADMIN', null).canManage).toBe(true);
    expect(projectRoleInfo('ADMIN', 'CLIENT').canManage).toBe(true);
  });

  it('retombe sur le rôle global tant que la requête n’a pas répondu', () => {
    expect(projectRoleInfo('SUPERVISOR', null).canManage).toBe(true);
    expect(projectRoleInfo('ARTIST', null).canManage).toBe(false);
  });

  it('ferme la contribution aux comptes clients', () => {
    expect(projectRoleInfo('CLIENT', null)).toEqual({
      role: 'CLIENT',
      canManage: false,
      canContribute: false,
    });
    expect(projectRoleInfo('ARTIST', 'CLIENT').canContribute).toBe(false);
  });

  it('ne conclut rien sans compte chargé', () => {
    expect(projectRoleInfo(undefined, null)).toEqual({
      role: null,
      canManage: false,
      canContribute: false,
    });
  });
});
