// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SparkRenderer } from '@sparkjsdev/spark';

/**
 * LOD of the splat viewer (10.G-V7): adjustable mode **auto** (default) / enabled / disabled /
 * streaming. In auto, a state machine watches the FPS: below 15 fps for 5 s the LOD turns on; it
 * only turns off above 25 fps for 5 s (hysteresis, so no flicker). The default is persisted per
 * media (`splatPresentation.lodDefault`).
 */
export type LodMode = 'auto' | 'on' | 'off' | 'streaming';

export interface AutoLodOptions {
  engageFps?: number;
  engageMs?: number;
  releaseFps?: number;
  releaseMs?: number;
}

export interface AutoLod {
  /** Advances the machine with an FPS sample; returns the engaged state. */
  step(fps: number, dtMs: number): boolean;
  readonly engaged: boolean;
}

export function createAutoLod({
  engageFps = 15,
  engageMs = 5000,
  releaseFps = 25,
  releaseMs = 5000,
}: AutoLodOptions = {}): AutoLod {
  let acc = 0;
  let engaged = false;
  return {
    step(fps: number, dtMs: number) {
      if (!engaged) {
        acc = fps < engageFps ? acc + dtMs : 0;
        if (acc >= engageMs) {
          engaged = true;
          acc = 0;
        }
      } else {
        acc = fps > releaseFps ? acc + dtMs : 0;
        if (acc >= releaseMs) {
          engaged = false;
          acc = 0;
        }
      }
      return engaged;
    },
    get engaged() {
      return engaged;
    },
  };
}

type LodTarget = Pick<SparkRenderer, 'enableLod' | 'enableLodFetching'>;

/** Applies the LOD state to the SparkRenderer (streaming = LOD and on-demand page fetching). */
export function applyLod(spark: LodTarget, active: boolean, streaming: boolean): void {
  spark.enableLod = active;
  spark.enableLodFetching = streaming;
}
