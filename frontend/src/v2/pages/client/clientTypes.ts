// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { LightingConfig, SplatEdits, SplatPresentation } from '../review/reviewTypes';
import type { UsdVariantSet } from '../../types/usd';

/**
 * Response of `GET /api/client/:token/media/:id/url` as the public page consumes it.
 *
 * Today the route serves only `url` and `slateSec`. Everything else describes the **persisted
 * staging** a spatial media needs to be replayed identically for the guest (converted GLB,
 * camera presentation, lighting, splat edits, scene override). These fields are therefore
 * **optional**: viewers degrade cleanly while the route does not send them yet, and fill in
 * on their own the day it does. The exact extension expected is recorded in the batch report.
 */
export interface ClientMediaSource {
  /** Served file: client derivative (video, slate first) or the media source. */
  url: string;
  /** Duration of the slate at the head of the client derivative (35.A), used to offset timestamps. */
  slateSec?: number;
  /** Converted GLB (`metadata.glbKey`): required whenever the original is not glTF. */
  glbUrl?: string | null;
  /** Media frame rate: without it the guest player cannot count frames. */
  fps?: number | null;
  /** Project start frame (studio numbering), displayed by the transport. */
  startFrame?: number | null;
  /** "ReView override" of the 3D scene (46.D): staging replayed for everyone. */
  usdOverride?: unknown;
  /** USD scene prim paths: the indexing key of the override. */
  usdPrimPaths?: string[] | null;
  /** Variant sets active at conversion: the composition base of the override. */
  usdVariantSets?: UsdVariantSet[] | null;
  /** Non-destructive splat edits (transform, flip, crop volumes). */
  splatEdits?: SplatEdits | null;
  /** Binary deletion mask (bitset), presigned URL. */
  splatMaskUrl?: string | null;
  /** Binary transform operations on subsets, presigned URL. */
  splatSubsetUrl?: string | null;
  /** Persisted presentation: camera, frame aspect, DoF, LOD, lighting. */
  splatPresentation?: SplatPresentation | null;
  /** Delivery ratio inherited from pipeline settings: default frame (cf. `reviewAspect.ts`). */
  deliveryAspect?: number | null;
  /** Default project lighting (39.F), fallback when the media has its own. */
  projectDefaultLighting?: LightingConfig | null;
  /** HDRI referenced by the presentation, already resolved to a presigned URL for the guest. */
  hdri?: { url: string; format: 'hdr' | 'exr' } | null;
}
