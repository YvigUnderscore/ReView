// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { formFromOverride, overrideFromForm } from './pipelineForm';
import type { PipelineSettings } from '../../types/api';

const inherited: PipelineSettings = { resolution: { width: 1920, height: 1080 }, framerate: 24 };

describe('pipelineForm — UI inheritance (Phase 19)', () => {
  it('formFromOverride: inherited when there is no override', () => {
    const f = formFromOverride(undefined, inherited);
    expect(f).toEqual({ custom: false, width: '1920', height: '1080', framerate: '24' });
  });

  it('formFromOverride: an empty override {} stays inherited', () => {
    expect(formFromOverride({}, inherited).custom).toBe(false);
  });

  it('formFromOverride: override present → custom + values', () => {
    const f = formFromOverride({ resolution: { width: 3840, height: 2160 }, framerate: 30 }, inherited);
    expect(f).toEqual({ custom: true, width: '3840', height: '2160', framerate: '30' });
  });

  it('overrideFromForm: not customized → {} (inherits)', () => {
    expect(overrideFromForm({ custom: false, width: '999', height: '9', framerate: '1' }, inherited)).toEqual(
      {},
    );
  });

  it('overrideFromForm: customized → values entered', () => {
    const o = overrideFromForm({ custom: true, width: '1280', height: '720', framerate: '25' }, inherited);
    expect(o).toEqual({ resolution: { width: 1280, height: 720 }, framerate: 25 });
  });

  it('overrideFromForm: invalid entry → fallback to inheritance', () => {
    const o = overrideFromForm({ custom: true, width: '', height: 'abc', framerate: '0' }, inherited);
    expect(o).toEqual({ resolution: { width: 1920, height: 1080 }, framerate: 24 });
  });

  it('round-trip form → override → form', () => {
    const start = { custom: true, width: '2048', height: '858', framerate: '48' };
    expect(formFromOverride(overrideFromForm(start, inherited), inherited)).toEqual(start);
  });
});
