/**
 * Scene detection (34.H) : parsing de la sortie `showinfo` de FFmpeg — le worker lance
 * `select='gt(scene,S)',showinfo` et pose un marqueur de timeline « Plan n » à chaque
 * coupe détectée. Helpers purs, testés ; la passe FFmpeg vit dans le worker.
 */

/** Seuil de scène FFmpeg (0..1) — 0.4 : coupes franches sans sur-détection. */
export const SCENE_THRESHOLD = 0.4;

/** Garde-fou : nombre max de marqueurs auto posés par vidéo. */
export const MAX_SCENE_MARKERS = 120;

/** Extrait les instants (s) des frames retenues dans la sortie stderr de showinfo. */
export function parseSceneTimes(stderr: string): number[] {
  const times: number[] = [];
  for (const m of stderr.matchAll(/pts_time:([0-9]+(?:\.[0-9]+)?)/g)) {
    const t = Number(m[1]);
    if (Number.isFinite(t)) times.push(t);
  }
  return times;
}

/**
 * Frames de début de plan (uniques, croissantes, hors frame 0 — le plan 1 commence au
 * début), bornées au garde-fou. `fps` de la sonde, repli 24.
 */
export function sceneFrames(times: number[], fps: number, max = MAX_SCENE_MARKERS): number[] {
  const f = fps > 0 && Number.isFinite(fps) ? fps : 24;
  const frames = [...new Set(times.map((t) => Math.round(t * f)))].filter((x) => x > 0).sort((a, b) => a - b);
  return frames.slice(0, max);
}
