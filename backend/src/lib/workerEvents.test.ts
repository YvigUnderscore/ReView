// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { decodeWorkerEvent, encodeWorkerEvent, type WorkerHlsEvent } from './workerEvents';

describe('workerEvents — worker → server channel (34.F)', () => {
  const evt: WorkerHlsEvent = {
    type: 'hls',
    mediaId: 42,
    versionId: 7,
    projectId: 3,
    renditions: 2,
    building: true,
  };

  it('encode/decode round trip', () => {
    expect(decodeWorkerEvent(encodeWorkerEvent(evt))).toEqual(evt);
  });

  it('decodes marker events (scene detection 34.H)', () => {
    expect(decodeWorkerEvent(encodeWorkerEvent({ type: 'markers', mediaId: 9 }))).toEqual({
      type: 'markers',
      mediaId: 9,
    });
  });

  it('ignores corrupted or unknown messages', () => {
    expect(decodeWorkerEvent('pas du json')).toBeNull();
    expect(decodeWorkerEvent('{"type":"autre"}')).toBeNull();
    expect(decodeWorkerEvent('{"type":"hls","mediaId":"nope"}')).toBeNull();
  });
});
