// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { PipelineOverride, PipelineSettings } from '../../types/api';

/** Form state of a pipeline override (editable strings + inherit/customize toggle). */
export interface PipelineForm {
  custom: boolean;
  width: string;
  height: string;
  framerate: string;
}

/** Applies a partial override onto a pipeline base (client mirror of the backend). */
export function applyOverride(base: PipelineSettings, o: PipelineOverride | undefined): PipelineSettings {
  if (!o) return base;
  return {
    resolution: o.resolution ?? base.resolution,
    framerate: o.framerate ?? base.framerate,
  };
}

function toInt(v: string, fallback: number): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
function toNum(v: string, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Builds the form state from an existing override plus the inherited values.
 * The fields are prefilled with the override if present, otherwise with the parent's inherited value.
 */
export function formFromOverride(o: PipelineOverride | undefined, inherited: PipelineSettings): PipelineForm {
  const custom = !!(o && (o.resolution || o.framerate !== undefined));
  return {
    custom,
    width: String(o?.resolution?.width ?? inherited.resolution.width),
    height: String(o?.resolution?.height ?? inherited.resolution.height),
    framerate: String(o?.framerate ?? inherited.framerate),
  };
}

/**
 * Override to send to the backend: `{}` (inherits) if not customized, otherwise the resolution and
 * frame rate entered (falling back to the inherited value if the entry is empty or invalid).
 */
export function overrideFromForm(f: PipelineForm, inherited: PipelineSettings): PipelineOverride {
  if (!f.custom) return {};
  return {
    resolution: {
      width: toInt(f.width, inherited.resolution.width),
      height: toInt(f.height, inherited.resolution.height),
    },
    framerate: toNum(f.framerate, inherited.framerate),
  };
}
