// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Shape } from '../../components/AnnotationCanvas';
import type { Hotspot3D } from '../review/reviewTypes';

/**
 * What a guest attaches to their comment: **pure**, so testable without mounting a viewer.
 *
 * The format is the internal review's (`useSubmitComment`): an array of "parts" read back
 * by `splitAnnotationParts`. There is no "client" format. A client's feedback is reopened
 * in the artist's review, and two diverging formats would mean a drawing that no longer
 * displays six months later.
 *
 * What the guest does NOT attach, and the backend refuses from them: a 3D staging proposal
 * (`scene-override`), a camera animation, painter strokes. These are author gestures
 * replayed for all viewers, not client remarks.
 */

/** Fallback content when the guest sends only a drawing: the server requires text. */
const DRAWING_ONLY = '(annotation)';

export interface GuestAnnotationInput {
  shapes: readonly Shape[];
  /** Surface point placed on a 3D model or a splat. */
  hotspot?: Hotspot3D | null;
}

/**
 * Assembles the parts. The hotspot comes first, as internally: `splitAnnotationParts` keeps
 * only one, and the order decides which.
 */
export function buildGuestAnnotation({ shapes, hotspot }: GuestAnnotationInput): unknown[] | undefined {
  const parts: unknown[] = [];
  if (hotspot)
    parts.push({
      type: 'hotspot',
      position: hotspot.position,
      normal: hotspot.normal,
      ...(hotspot.space ? { space: hotspot.space } : {}),
    });
  parts.push(...shapes);
  return parts.length > 0 ? parts : undefined;
}

/** A drawing alone counts as feedback: the text becomes optional once there is an annotation. */
export function guestCommentContent(text: string, annotation: unknown[] | undefined): string | null {
  const trimmed = text.trim();
  if (trimmed) return trimmed;
  return annotation ? DRAWING_ONLY : null;
}

/**
 * Frame number cited by the guest, in the studio's numbering. It is computed on the **media**
 * time (slate removed): the guest and the artist must talk about the same image.
 */
export function frameOf(mediaSeconds: number, fps: number, startFrame: number): number {
  if (!Number.isFinite(fps) || fps <= 0) return startFrame;
  return startFrame + Math.round(Math.max(0, mediaSeconds) * fps);
}
