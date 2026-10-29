// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

// `vi.mock` is hoisted to the top of the file: the doubles must be too.
const { playlist, links } = vi.hoisted(() => ({
  playlist: { findUnique: vi.fn() },
  links: { findByLocal: vi.fn(), upsertLink: vi.fn(), mapLocalToSg: vi.fn() },
}));

vi.mock('../../lib/prisma', () => ({ prisma: { playlist } }));
vi.mock('../../lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('./shotgridLinks', () => ({
  findByLocal: (...args: unknown[]) => links.findByLocal(...args),
  upsertLink: (...args: unknown[]) => links.upsertLink(...args),
  mapLocalToSg: (...args: unknown[]) => links.mapLocalToSg(...args),
  mapSgToLocal: vi.fn(),
}));

import { mergePlaylistVersions, pushPlaylist, type PlaylistPushContext } from './ShotgridPlaylistSync';
import type { SgRecord } from './shotgridMapper';

type MockedClient = { findById: ReturnType<typeof vi.fn> };
type MockedWriter = { create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };

function contextWith(
  remote: SgRecord | null = null,
): PlaylistPushContext & { client: MockedClient; writer: MockedWriter } {
  return {
    connectionId: 1,
    sgProjectId: 42,
    sgProjectName: 'ALPHA',
    asUserLogin: 'lea@studio.fr',
    client: { findById: vi.fn(async () => remote) },
        // Segregation is no longer this module's business: `ShotgridWriter` applies it, and it has its own suite. Only the write itself is doubled here.
    writer: {
      create: vi.fn(async () => ({ id: 900, type: 'Playlist' })),
      update: vi.fn(async () => ({ id: 900, type: 'Playlist' })),
    },
  };
}

const version = (id: number) => ({ type: 'Version', id });

/** Playlist as the site returns it before writing. */
const sgRemote = (
  versions: Array<{ type: string; id: number }>,
  over: Record<string, unknown> = {},
): SgRecord => ({
  type: 'Playlist',
  id: 777,
  code: 'Dailies',
  project: { type: 'Project', id: 42, name: 'ALPHA' },
  versions,
  ...over,
});

/** Local version -> ShotGrid version matches, as `mapLocalToSg` returns them. */
const versionLinks = (pairs: Array<[number, number]>) =>
  new Map(pairs.map(([localId, sgId]) => [localId, { localId, sgId, sgType: 'Version' }]));

/** Local playlist linked to the remote playlist 777. */
function localPlaylist(versionIds: number[]) {
  playlist.findUnique.mockResolvedValue({
    id: 5,
    name: 'Dailies',
    items: versionIds.map((versionId) => ({ versionId })),
  });
  links.findByLocal.mockImplementation(async (_c: number, type: string) =>
    type === 'playlist' ? { sgId: 777, sgType: 'Playlist' } : null,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  links.upsertLink.mockResolvedValue(undefined);
    // 11, 12, 13 are imported from ShotGrid; 99 does not exist there.
  links.mapLocalToSg.mockResolvedValue(
    versionLinks([
      [11, 111],
      [12, 112],
      [13, 113],
    ]),
  );
});

describe('pushPlaylist: creation', () => {
  it("sends the versions in the session's order", async () => {
        // A playlist is a sequence of events: order matters as much as content.
    playlist.findUnique.mockResolvedValue({
      id: 5,
      name: 'Dailies 12/06',
      items: [{ versionId: 11 }, { versionId: 12 }, { versionId: 13 }],
    });
    links.findByLocal.mockResolvedValue(null);

    const ctx = contextWith();
    const sgId = await pushPlaylist(ctx, 5);

    expect(sgId).toBe(900);
        // No `project` in the payload: `ShotgridWriter` sets it, and its own suite checks that it refuses to target another one.
    expect(ctx.writer.create).toHaveBeenCalledWith('Playlist', {
      code: 'Dailies 12/06',
      versions: [version(111), version(112), version(113)],
    });
  });

  it('ignores the versions ShotGrid does not know', async () => {
        // Inventing them would create entries leading nowhere.
    playlist.findUnique.mockResolvedValue({
      id: 5,
      name: 'Dailies',
      items: [{ versionId: 11 }, { versionId: 99 }],
    });
    links.findByLocal.mockResolvedValue(null);

    const ctx = contextWith();
    await pushPlaylist(ctx, 5);

    expect(ctx.writer.create.mock.calls[0]![1]).toMatchObject({ versions: [version(111)] });
  });

  it('touches nothing when the local playlist has disappeared', async () => {
    playlist.findUnique.mockResolvedValue(null);

    const ctx = contextWith();
    expect(await pushPlaylist(ctx, 5)).toBeNull();
    expect(ctx.writer.create).not.toHaveBeenCalled();
    expect(ctx.writer.update).not.toHaveBeenCalled();
  });
});

/**
 * The remote content was rebuilt from the ReView state alone and then overwritten: any version set on the site and not imported here disappeared from the studio's
 * session. A destructive write on a third-party production system cannot be undone — hence the prior read and the merge.
 */
describe('pushPlaylist: non-destructive update', () => {
  it('updates the already linked playlist instead of creating a second one', async () => {
        // Without this, every reordering would leave one more session in the studio.
    localPlaylist([11]);

    const ctx = contextWith(sgRemote([version(112)]));
    const sgId = await pushPlaylist(ctx, 5);

    expect(sgId).toBe(777);
    expect(ctx.writer.create).not.toHaveBeenCalled();
    expect(ctx.writer.update).toHaveBeenCalledWith(
      'Playlist',
      777,
      { code: 'Dailies', versions: [version(111)] },
      { asUserLogin: 'lea@studio.fr' },
    );
  });

  it('preserves a remote version that ReView does not know, in its place', async () => {
    localPlaylist([11, 13]);

    const ctx = contextWith(sgRemote([version(500), version(111), version(112)]));
    await pushPlaylist(ctx, 5);

        // 500 stays at the head; the slot of 112, known and removed here, moves to 113.
    expect(ctx.writer.update.mock.calls[0]![2]).toEqual({
      code: 'Dailies',
      versions: [version(500), version(111), version(113)],
    });
  });

  it('adds the version added on the ReView side', async () => {
    localPlaylist([11, 12]);

    const ctx = contextWith(sgRemote([version(111)]));
    await pushPlaylist(ctx, 5);

    expect(ctx.writer.update.mock.calls[0]![2]).toMatchObject({
      versions: [version(111), version(112)],
    });
  });

  it('removes the version that ReView knew and has removed', async () => {
    localPlaylist([11]);

    const ctx = contextWith(sgRemote([version(111), version(112)]));
    await pushPlaylist(ctx, 5);

    expect(ctx.writer.update.mock.calls[0]![2]).toMatchObject({ versions: [version(111)] });
  });

  it('neither removes nor moves a version from another project of the site', async () => {
        // No match for this connection: it is not of this project, so ReView has nothing to say about it, even when the local session empties.
    localPlaylist([]);

    const ctx = contextWith(sgRemote([version(111), version(600), version(112)]));
    await pushPlaylist(ctx, 5);

    expect(ctx.writer.update.mock.calls[0]![2]).toMatchObject({ versions: [version(600)] });
  });

  it('propagates the session order without moving the unknown versions', async () => {
    localPlaylist([12, 11]);

    const ctx = contextWith(sgRemote([version(111), version(700), version(112)]));
    await pushPlaylist(ctx, 5);

        // 700 keeps its rank; the two slots governed by ReView are recomposed.
    expect(ctx.writer.update.mock.calls[0]![2]).toMatchObject({
      versions: [version(112), version(700), version(111)],
    });
  });

  it('writes nothing when the remote already says the same thing', async () => {
    localPlaylist([11]);

    const ctx = contextWith(sgRemote([version(500), version(111)]));
    const sgId = await pushPlaylist(ctx, 5);

    expect(sgId).toBe(777);
    expect(ctx.writer.update).not.toHaveBeenCalled();
  });

  it('writes when only the name has changed', async () => {
    localPlaylist([11]);

    const ctx = contextWith(sgRemote([version(111)], { code: 'Ancien nom' }));
    await pushPlaylist(ctx, 5);

    expect(ctx.writer.update.mock.calls[0]![2]).toMatchObject({ code: 'Dailies' });
  });

    /**
     * Project segregation and the refusal of template projects were checked here, on a local copy of the three controls. That copy has disappeared: `ShotgridWriter`
     * applies them to **all** the file's writes, and `ShotgridWriter.test.ts` tests them: target passed to another project, template project, vanished target. Replaying
     * them here would only test the double.
     */

  it('gives up without recreating anything when the remote playlist has disappeared', async () => {
        // Recreating it would put back into the studio a session deleted by hand.
    localPlaylist([11]);

    const ctx = contextWith(null);
    expect(await pushPlaylist(ctx, 5)).toBeNull();
    expect(ctx.writer.update).not.toHaveBeenCalled();
    expect(ctx.writer.create).not.toHaveBeenCalled();
  });
});

describe('mergePlaylistVersions', () => {
  const known = new Set([111, 112, 113]);

  it('preserves an entry that is not a version', () => {
        // A site may set something else in the field: we do not interpret it, we keep it.
    const merged = mergePlaylistVersions({
      remote: [
        { type: 'Shot', id: 42 },
        { type: 'Version', id: 111 },
      ],
      local: [111],
      known,
    });
    expect(merged).toEqual([
      { type: 'Shot', id: 42 },
      { type: 'Version', id: 111 },
    ]);
  });

  it('does not duplicate a version already present remotely', () => {
    const merged = mergePlaylistVersions({ remote: [{ type: 'Version', id: 111 }], local: [111], known });
    expect(merged).toEqual([{ type: 'Version', id: 111 }]);
  });

  it('leaves the remote intact when ReView has nothing to say', () => {
    const remote = [
      { type: 'Version', id: 500 },
      { type: 'Version', id: 501 },
    ];
    expect(mergePlaylistVersions({ remote, local: [], known })).toEqual(remote);
  });
});
