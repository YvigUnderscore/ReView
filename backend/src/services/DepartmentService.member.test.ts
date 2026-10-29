// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * A member's departments on a project (batch 10).
 *
 * Two invariants are pinned here, and they protect data that cannot be recovered.
 *
 * 1. **Never a `set`.** From the Members tab one only sees a project's vocabulary; replacing the whole list
 * would silently erase the departments
 *    the person holds from another project or from the studio reference.
 * 2. **Identifiers are checked in both directions.** An identifier taken elsewhere must neither be added nor,
 * above all, removed: unhooking someone from a project one is not even looking at would be invisible until
 * their work disappeared from the filters.
 */
const { db, logAudit } = vi.hoisted(() => ({
  db: {
    projectMembership: { findUnique: vi.fn() },
    project: { findUnique: vi.fn() },
    department: { findMany: vi.fn() },
    user: { update: vi.fn(), findUnique: vi.fn() },
  },
  logAudit: vi.fn(),
}));

vi.mock('../lib/prisma', () => ({ prisma: db }));
vi.mock('./AuditService', () => ({ logAudit }));
vi.mock('./StorageService', () => ({
  storage: { getPresignedGetUrl: vi.fn(), getPresignedPutUrl: vi.fn(), forgetPresignedUrl: vi.fn() },
  StorageService: { departmentImageKey: vi.fn() },
}));

import { setMemberDepartments } from './DepartmentService';

const ACTOR = { id: 1 };

beforeEach(() => {
  vi.clearAllMocks();
  db.projectMembership.findUnique.mockResolvedValue({ id: 42 });
  db.project.findUnique.mockResolvedValue({ studioId: 1 });
  // Project 7's vocabulary: one project-specific step, one step inherited from the studio.
  db.department.findMany.mockResolvedValue([{ id: 10 }, { id: 11 }]);
  db.user.update.mockResolvedValue({});
  db.user.findUnique.mockResolvedValue({ departments: [{ id: 10, key: 'COMP', name: 'Compositing' }] });
});

describe('setMemberDepartments', () => {
  it('refuses a person who is not a member of the project', async () => {
    db.projectMembership.findUnique.mockResolvedValue(null);
    await expect(setMemberDepartments(ACTOR, 7, 5, { add: [10] })).rejects.toThrow();
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it('ticks and unticks by name, never replacing the list', async () => {
    await setMemberDepartments(ACTOR, 7, 5, { add: [10], remove: [11] });
    const data = db.user.update.mock.calls[0]![0].data as {
      departments: Record<string, unknown>;
    };
    expect(data.departments).toEqual({ connect: [{ id: 10 }], disconnect: [{ id: 11 }] });
    // The day a `set` came back, the departments of other projects would leave with it — hence the explicit
    // assertion.
    expect(data.departments).not.toHaveProperty('set');
  });

  it('refuses a department foreign to the project, both when adding and when removing', async () => {
    await expect(setMemberDepartments(ACTOR, 7, 5, { add: [99] })).rejects.toThrow();
    await expect(setMemberDepartments(ACTOR, 7, 5, { remove: [99] })).rejects.toThrow();
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it('lets the addition take precedence over the removal when the same identifier appears on both sides', async () => {
    // Two quick toggles in a menu: the batch must not cancel itself out.
    await setMemberDepartments(ACTOR, 7, 5, { add: [10], remove: [10] });
    const data = db.user.update.mock.calls[0]![0].data as {
      departments: { connect: unknown[]; disconnect: unknown[] };
    };
    expect(data.departments.connect).toEqual([{ id: 10 }]);
    expect(data.departments.disconnect).toEqual([]);
  });

  it('neither writes nor logs anything when the batch is empty', async () => {
    await setMemberDepartments(ACTOR, 7, 5, {});
    expect(db.user.update).not.toHaveBeenCalled();
    expect(logAudit).not.toHaveBeenCalled();
  });

  it('returns the member\'s list bounded to the project\'s vocabulary, and logs the gesture', async () => {
    const out = await setMemberDepartments(ACTOR, 7, 5, { add: [10] });
    expect(out).toEqual([{ id: 10, key: 'COMP', name: 'Compositing' }]);
    expect(db.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        select: {
          departments: expect.objectContaining({
            where: { deletedAt: null, OR: [{ projectId: 7 }, { projectId: null }] },
          }),
        },
      }),
    );
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'PROJECT_MEMBER_DEPARTMENTS', entityId: 7 }),
    );
  });
});
