// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi } from 'vitest';

vi.mock('../lib/prisma', () => ({ prisma: {} }));
vi.mock('../lib/storage', () => ({ storage: { getPresignedGetUrl: vi.fn() } }));

import { ShareScope } from '@prisma/client';
import {
  dropSplatEditBlobs,
  publishedMediaWhere,
  shareMediaWhere,
  sharePlaylistWhere,
  type ShareScopeRef,
} from './ClientShareService';

describe('publishedMediaWhere: what a visitor to the public link sees', () => {
  const where = publishedMediaWhere(7);

  // Each branch of the OR leads to a different entity (shot carried by a task, asset carried by a task,
  // direct asset): only that entity carries projectId/deletedAt.
  const ownerOf = (branch: (typeof where.version.OR)[number]) =>
    branch.task ? (branch.task.shot ?? branch.task.asset) : branch.asset;

  it('exposes only the ready, published media of a published version', () => {
    expect(where.status).toBe('READY');
    expect(where.published).toBe(true);
    expect(where.version.published).toBe(true);
  });

  // The trash is a soft delete: without these filters, a deleted shot stays listed and downloadable on the
  // public link although it has disappeared from the internal interface.
  it('excludes the trash at every level of the hierarchy', () => {
    expect(where.deletedAt).toBeNull();
    expect(where.version.deletedAt).toBeNull();
    for (const branch of where.version.OR) {
      expect(ownerOf(branch)).toMatchObject({ projectId: 7, deletedAt: null });
    }
  });

  it('remains bounded to the shared project', () => {
    for (const branch of where.version.OR) {
      expect(ownerOf(branch)?.projectId).toBe(7);
    }
  });
});

/**
 * The scope is the only thing separating "show a shot" from "open the whole film". It must therefore RESTRICT
 * the public filter, never replace it: a playlist link that forgot `published` would show drafts, and a link
 * whose target has disappeared must above all not fall back to the project.
 */
describe('shareMediaWhere: what the scope removes from the public filter', () => {
  const base: ShareScopeRef = {
    projectId: 7,
    scope: ShareScope.PROJECT,
    playlistId: null,
    versionId: null,
    mediaIds: [],
  };
  const publicFilter = publishedMediaWhere(7);

  it('leaves the public filter intact for a project link', () => {
    expect(shareMediaWhere(base)).toEqual(publicFilter);
  });

  it('adds the playlist without losing the publication guarantees', () => {
    const where = shareMediaWhere({ ...base, scope: ShareScope.PLAYLIST, playlistId: 3 });
    expect(where.published).toBe(true);
    expect(where.deletedAt).toBeNull();
    expect(where.version).toMatchObject({
      published: true,
      deletedAt: null,
      playlistItems: { some: { playlistId: 3 } },
    });
    // The project membership OR remains: a playlist cannot serve as a pass.
    expect((where.version as { OR?: unknown[] }).OR).toHaveLength(3);
  });

  it('bounds a version link to that version', () => {
    expect(shareMediaWhere({ ...base, scope: ShareScope.VERSION, versionId: 42 })).toMatchObject({
      versionId: 42,
      published: true,
    });
  });

  it('bounds a selection link to the chosen media', () => {
    const where = shareMediaWhere({ ...base, scope: ShareScope.MEDIA, mediaIds: [11, 12] });
    expect(where.id).toEqual({ in: [11, 12] });
    expect(where.published).toBe(true);
  });

  // Cascade and CHECK constraint make these states impossible in the database; should they occur, a silent
  // widening would be the worst possible answer.
  it('shows nothing rather than everything when the target is missing', () => {
    for (const broken of [
      { ...base, scope: ShareScope.PLAYLIST },
      { ...base, scope: ShareScope.VERSION },
      { ...base, scope: ShareScope.MEDIA },
    ]) {
      expect(shareMediaWhere(broken)).toEqual({ id: { in: [] } });
    }
  });
});

/**
 * A playlist carries a production NAME ("Client return — final"), and the public page's home displays the
 * list. It is therefore a disclosure in its own right: the scope must bound it just as it bounds the media.
 */
describe('sharePlaylistWhere: which playlists a link is allowed to name', () => {
  const base: ShareScopeRef = {
    projectId: 7,
    scope: ShareScope.PROJECT,
    playlistId: null,
    versionId: null,
    mediaIds: [],
  };

  it('retains, for a project link, only the playlists that really open a media', () => {
    const where = sharePlaylistWhere(base);
    expect(where).toMatchObject({ projectId: 7 });
    // The `some` is written with the scope filter itself: a playlist cannot serve as a pass to a draft or to
    // the trash.
    expect(where?.items).toEqual({ some: { version: { media: { some: shareMediaWhere(base) } } } });
  });

  it('pins a playlist link to its own playlist, and to the project', () => {
    const where = sharePlaylistWhere({ ...base, scope: ShareScope.PLAYLIST, playlistId: 3 });
    expect(where).toMatchObject({ id: 3, projectId: 7 });
  });

  /**
   * The crucial point: listing "the playlists containing this version" would technically be within the scope
   * of MEDIA, yet would reveal the existence of dailies the recipient never received. A scope that shows only
   * one shot names nothing.
   */
  it('names NO playlist for a version or selection link', () => {
    expect(sharePlaylistWhere({ ...base, scope: ShareScope.VERSION, versionId: 42 })).toBeNull();
    expect(sharePlaylistWhere({ ...base, scope: ShareScope.MEDIA, mediaIds: [11] })).toBeNull();
  });

  it('does not fall back to all playlists when the target has disappeared', () => {
    expect(sharePlaylistWhere({ ...base, scope: ShareScope.PLAYLIST })).toBeNull();
  });
});

/**
 * Hiding (`hiddenAt`, see `VisibilityRule`): the item exists, no internal screen offers it. As long as the
 * public page only showed a grid of file names, letting it through was barely visible; since it groups media
 * by entity, it would display the name and code of what we have just decided to hide.
 */
describe('publishedMediaWhere: hiding carries over to the public link', () => {
  const where = publishedMediaWhere(7);
  const shotBranch = where.version.OR[0] as {
    task: { shot: { hiddenAt: null; OR: { sequenceId?: null; sequence?: { hiddenAt: null } }[] } };
  };

  it('excludes a hidden shot, asset or sequence', () => {
    expect(shotBranch.task.shot.hiddenAt).toBeNull();
    expect(where.version.OR[1]).toMatchObject({ task: { asset: { hiddenAt: null } } });
    expect(where.version.OR[2]).toMatchObject({ asset: { hiddenAt: null } });
  });

  // A shot without a sequence is a NORMAL case (feature film): requiring a visible sequence without this
  // alternative would exclude it from sharing.
  it('requires the sequence to be visible only when there is one', () => {
    expect(shotBranch.task.shot.OR).toEqual([
      { sequenceId: null },
      { sequence: { deletedAt: null, hiddenAt: null } },
    ]);
  });
});

/**
 * Batch 14: the mask and ops of a cloud-edit proposal are stored as attachments of the comment: that is what
 * gives them their purge. On a PUBLIC page, presigning them would offer the client a bitset they will never
 * open, and bring an internal object URL down. They are therefore excluded before presigning, by their key: a
 * genuine file attached by the studio, on the other hand, still goes through.
 */
describe('dropSplatEditBlobs: what a public link does not presign', () => {
  const mask = { key: 'comments/attachments/1/mask.bin', name: 'splat-mask.bin' };
  const pdf = { key: 'comments/attachments/1/notes.pdf', name: 'notes.pdf' };
  const annotation = [
    { type: 'splat-edit', transform: null, volumes: [], mask: { key: mask.key, count: 3 }, subset: null },
  ];

  it('excludes the binary the proposal references', () => {
    expect(dropSplatEditBlobs([mask, pdf], annotation)).toEqual([pdf]);
  });

  it('touches nothing without a proposal', () => {
    expect(dropSplatEditBlobs([mask, pdf], [{ type: 'poi', points: [] }])).toEqual([mask, pdf]);
  });

  it("keeps a same-named file that is not the proposal's", () => {
    const other = { key: 'comments/attachments/2/mask.bin', name: 'splat-mask.bin' };
    expect(dropSplatEditBlobs([other], annotation)).toEqual([other]);
  });
});
