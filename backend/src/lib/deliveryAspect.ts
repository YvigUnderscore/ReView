// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { prisma } from './prisma';
import { resolveEntitySettings, resolveProjectSettingsById, type Resolution } from './projectSettings';

/**
 * Delivery frame ratio of a media, inherited from the pipeline settings.
 *
 * WHY. The review frame of spatial media (3D, splat) is letterboxed at a fixed aspect, and its tooltip
 * announced from the start "inherited from the shot's pipeline settings". Nobody served it that: the
 * aspect came from the saved camera presentation, which merely copied the camera's aspect… itself taken
 * from the 16/9 default. The first staging save therefore froze 16/9 without anyone choosing it, whatever
 * the project's delivery resolution.
 *
 * The resolution is a pipeline setting inherited studio → project → sequence → shot
 * (`resolveEntitySettings`): it is what gives the ratio. The pattern is exactly that of
 * `ImageSequenceService.resolveSequenceFramerate` for the frame rate.
 */

/** Fallback: 16:9 — exactly the studio default resolution (1920×1080). */
export const DEFAULT_DELIVERY_ASPECT = 16 / 9;

/**
 * Width/height ratio of a delivery resolution. A missing or aberrant resolution falls back rather than
 * producing a `NaN`: a non-finite aspect makes a zero-height frame on screen, i.e. an empty viewer.
 */
export function aspectOfResolution(resolution: Resolution | null | undefined): number {
  const width = resolution?.width;
  const height = resolution?.height;
  const valid = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;
  if (!valid(width) || !valid(height)) return DEFAULT_DELIVERY_ASPECT;
  return width / height;
}

/**
 * Effective delivery ratio of a version: full inheritance studio → project → sequence → shot. A version
 * hanging from no task (hence no shot) takes the project's ratio.
 */
export async function resolveDeliveryAspect(versionId: number, projectId: number): Promise<number> {
  const [project, version] = await Promise.all([
    resolveProjectSettingsById(projectId),
    prisma.version.findUnique({
      where: { id: versionId },
      select: {
        task: { select: { shot: { select: { settings: true, sequence: { select: { settings: true } } } } } },
      },
    }),
  ]);
  const shot = version?.task?.shot ?? null;
  const pipeline = resolveEntitySettings(project, shot?.sequence?.settings, shot?.settings);
  return aspectOfResolution(pipeline.resolution);
}
