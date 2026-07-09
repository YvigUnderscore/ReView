import type { SparkRenderer } from '@sparkjsdev/spark';

/**
 * LOD du viewer splat (10.G-V7) : mode réglable **auto** (défaut) / activé / désactivé /
 * streaming. En auto, une machine à états surveille le FPS : sous 15 fps pendant 5 s le LOD
 * s'active ; il ne se désactive qu'au-dessus de 25 fps pendant 5 s (hystérésis — pas de
 * battement). Le défaut est persisté par média (`splatPresentation.lodDefault`).
 */
export type LodMode = 'auto' | 'on' | 'off' | 'streaming';

export interface AutoLodOptions {
  engageFps?: number;
  engageMs?: number;
  releaseFps?: number;
  releaseMs?: number;
}

export interface AutoLod {
  /** Avance la machine avec un échantillon de FPS ; renvoie l'état engagé. */
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

/** Applique l'état LOD au SparkRenderer (streaming = LOD + fetch de pages à la demande). */
export function applyLod(spark: LodTarget, active: boolean, streaming: boolean): void {
  spark.enableLod = active;
  spark.enableLodFetching = streaming;
}
