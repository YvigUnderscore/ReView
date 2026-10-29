// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { poiStoredPoints, poiUploadPlan } from './poiUpload';
import type { PoiDraft } from './usePoiDraft';

const img = (name: string) => new File(['x'], name, { type: 'image/png' });
const junk = (name: string) => new File(['x'], name, { type: 'application/x-msdownload' });

const point = (key: string, text: string, files: File[]): PoiDraft => ({
  key,
  position: '0 0 0',
  normal: '0 0 1',
  space: 'object',
  text,
  files,
});

describe('poiUploadPlan — a single upload, points first', () => {
  it('puts the point images ahead of those of the composer', () => {
    const plan = poiUploadPlan(
      [point('a', 'un', [img('a1.png')]), point('b', 'deux', [img('b1.png')])],
      [img('libre.png')],
    );
    expect(plan.files.map((f) => f.name)).toEqual(['a1.png', 'b1.png', 'libre.png']);
    expect(plan.counts).toEqual([1, 1]);
    expect(plan.dropped).toBe(0);
  });

  it('sets aside a refused type and counts it: the point keeps its other images', () => {
    const plan = poiUploadPlan([point('a', 'un', [junk('vir.exe'), img('a2.png')])], []);
    expect(plan.files.map((f) => f.name)).toEqual(['a2.png']);
    expect(plan.counts).toEqual([1]);
    expect(plan.dropped).toBe(1);
  });

  it("stops at the ceiling: it is the composer's attachments that fall last", () => {
    const plan = poiUploadPlan([point('a', 'un', [img('p1.png'), img('p2.png')])], [img('c1.png')], 2);
    expect(plan.files.map((f) => f.name)).toEqual(['p1.png', 'p2.png']);
    expect(plan.counts).toEqual([2]);
    expect(plan.dropped).toBe(1);
  });
});

describe('poiStoredPoints — each point recognises its images by their key', () => {
  it('splits the uploaded keys in the order of the plan', () => {
    const points = [point('a', ' un ', [img('a1.png'), img('a2.png')]), point('b', 'deux', [img('b1.png')])];
    const plan = poiUploadPlan(points, [img('libre.png')]);
    const uploaded = plan.files.map((f, i) => ({ key: `k${i}`, name: f.name, contentType: f.type }));
    const stored = poiStoredPoints(points, plan, uploaded);
    expect(stored[0]).toEqual({
      position: '0 0 0',
      normal: '0 0 1',
      space: 'object',
      text: 'un',
      images: ['k0', 'k1'],
    });
    // The composer's attachment (`k3`) belongs to no point: it stays with the comment.
    expect(stored[1].images).toEqual(['k2']);
  });

  it('writes neither empty text nor an empty list of images', () => {
    const points = [point('a', '   ', [])];
    const plan = poiUploadPlan(points, []);
    expect(poiStoredPoints(points, plan, [])).toEqual([
      { position: '0 0 0', normal: '0 0 1', space: 'object' },
    ]);
  });
});
