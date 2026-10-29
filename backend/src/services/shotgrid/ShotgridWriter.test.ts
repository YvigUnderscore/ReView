// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { ShotgridWriter } from './ShotgridWriter';
import type { ShotgridClient } from './ShotgridClient';

const findById = vi.fn();
const unsafeCreate = vi.fn();
const unsafeUpdate = vi.fn();
const unsafeUploadFile = vi.fn();

const SCOPE = { sgProjectId: 42, sgProjectName: 'ALPHA' };

function writer() {
  return new ShotgridWriter({
    ...SCOPE,
    client: { findById, unsafeCreate, unsafeUpdate, unsafeUploadFile } as unknown as ShotgridClient,
  });
}

/** Entity of the linked project, as the re-read returns it. */
const inProject = { id: 7, type: 'Shot', project: { type: 'Project', id: 42, name: 'ALPHA' } };

beforeEach(() => {
  vi.clearAllMocks();
  findById.mockResolvedValue(inProject);
  unsafeCreate.mockResolvedValue({ id: 900, type: 'Shot' });
  unsafeUpdate.mockResolvedValue({ id: 7, type: 'Shot' });
  unsafeUploadFile.mockResolvedValue(undefined);
});

describe('update', () => {
  it('writes when the target is indeed in the linked project', async () => {
    await writer().update('Shot', 7, { sg_status_list: 'ip' });

    expect(unsafeUpdate).toHaveBeenCalledWith('Shot', 7, { sg_status_list: 'ip' }, {});
  });

  /**
   * The costly case: a link points to an entity that was deleted then recreated under the same identifier in another project. Without a re-read, we write into
   * someone else's production.
   */
  it("doesn't write into an entity moved to another project", async () => {
    findById.mockResolvedValue({ ...inProject, project: { type: 'Project', id: 99, name: 'BETA' } });

    await expect(writer().update('Shot', 7, { sg_status_list: 'ip' })).resolves.toBeNull();
    expect(unsafeUpdate).not.toHaveBeenCalled();
  });

  it("doesn't write into a template project", async () => {
    findById.mockResolvedValue({
      ...inProject,
      project: { type: 'Project', id: 42, name: 'Template Project' },
    });

    await expect(writer().update('Shot', 7, {})).resolves.toBeNull();
    expect(unsafeUpdate).not.toHaveBeenCalled();
  });

  it("doesn't write into a target the site no longer returns", async () => {
    findById.mockResolvedValue(null);

    await expect(writer().update('Shot', 7, {})).resolves.toBeNull();
    expect(unsafeUpdate).not.toHaveBeenCalled();
  });
});

describe('create', () => {
  it('sets the linked project itself', async () => {
    await writer().create('Note', { subject: 'bonjour' });

    expect(unsafeCreate).toHaveBeenCalledWith(
      'Note',
      { subject: 'bonjour', project: { type: 'Project', id: 42 } },
      null,
    );
  });

  /**
   * A caller does not choose the project: it is a programming error, not data to arbitrate. We refuse before any request goes out.
   */
  it('refuses a payload targeting another project', async () => {
    await expect(writer().create('Note', { project: { type: 'Project', id: 99 } })).rejects.toThrow();
    expect(unsafeCreate).not.toHaveBeenCalled();
  });

  it('accepts a payload that repeats the right project', async () => {
    await writer().create('Note', { project: { type: 'Project', id: 42 } });

    expect(unsafeCreate).toHaveBeenCalled();
  });

  /** It is the site that decides what it has written — we re-read it before rejoicing. */
  it('throws when the site has deposited the entity elsewhere', async () => {
    findById.mockResolvedValue({
      id: 900,
      type: 'Note',
      project: { type: 'Project', id: 99, name: 'BETA' },
    });

    await expect(writer().create('Note', {})).rejects.toThrow();
  });

  it('passes on the account in whose name to write', async () => {
    await writer().create('Note', {}, { asUserLogin: 'lea@studio.fr' });

    expect(unsafeCreate).toHaveBeenCalledWith('Note', expect.anything(), 'lea@studio.fr');
  });
});

describe('upload', () => {
  it('deposits the file after the same re-read as update', async () => {
    await expect(
      writer().upload('Version', 7, 'image', Buffer.from('x'), 'a.webp', 'image/webp'),
    ).resolves.toBe(true);
    expect(unsafeUploadFile).toHaveBeenCalled();
  });

  it('deposits nothing on an entity of another project', async () => {
    findById.mockResolvedValue({ ...inProject, project: { type: 'Project', id: 99 } });

    await expect(
      writer().upload('Version', 7, 'image', Buffer.from('x'), 'a.webp', 'image/webp'),
    ).resolves.toBe(false);
    expect(unsafeUploadFile).not.toHaveBeenCalled();
  });
});
