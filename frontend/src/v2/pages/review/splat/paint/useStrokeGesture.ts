// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useRef } from 'react';
import type { Line2 } from 'three/addons/lines/Line2.js';
import type { SplatPaintStroke } from '../../reviewTypes';
import type { LineModules } from './lineModules';
import { buildStrokeLine, disposeStrokeLine } from './strokes';
import { raycastSurface, type PaintSceneHandle, type Viewport } from './surfaceRay';
import { breaksRun, flattenObject, runNormal, type SurfaceSample } from './surfaceTrace';

/**
 * Geste de la brosse de surface 3D : de l'échantillon écran au trait posé sur le nuage.
 *
 * Deux défauts du painter d'origine disparaissent ici. D'abord **l'aperçu** : le trait n'existait
 * qu'au lâcher, le geste ne montrant qu'une polyligne 2D plaquée sur l'écran, qui ne suivait pas
 * le relief — on découvrait le trait réel une fois trop tard. Chaque échantillon est maintenant
 * raycasté à la volée et la ligne 3D est reconstruite dans la foulée : ce qu'on voit pendant le
 * geste est exactement ce qui sera envoyé. Ensuite **la corde droite** : un geste qui traverse un
 * trou reliait les deux bords par un segment flottant. Un geste produit donc désormais *un ou
 * plusieurs* traits — un par portion continue de surface (cf. `surfaceTrace.breaksRun`).
 */
export interface StrokeGesture {
  /** Début du geste (appui). */
  begin: () => void;
  /** Un échantillon écran. Renvoie vrai si le rayon a touché la surface. */
  sample: (point: [number, number], viewport: Viewport) => boolean;
  /** Fin du geste (lâcher) : les portions continues deviennent des traits. */
  end: () => void;
  /** Abandonne l'aperçu sans rien poser (changement d'outil, démontage). */
  cancel: () => void;
}

/** Portion continue de surface en cours de tracé. */
interface Run {
  samples: SurfaceSample[];
  line: Line2 | null;
}

export function useStrokeGesture({
  getSceneHandle,
  getLines,
  color,
  width,
  onStrokes,
}: {
  getSceneHandle: () => PaintSceneHandle | null;
  /** Classes `Line2`, ou `null` si l'import à la demande n'est pas encore arrivé. */
  getLines: () => LineModules | null;
  color: string;
  width: number;
  onStrokes: (strokes: SplatPaintStroke[]) => void;
}): StrokeGesture {
  const runsRef = useRef<Run[]>([]);
  const lastScreenRef = useRef<[number, number] | null>(null);
  // Portion ouverte : fermée par un rayon dans le vide ou par une coupure de surface.
  const openRef = useRef(false);
  // Couleur et épaisseur relues au moment du geste, jamais celles capturées au montage.
  const styleRef = useRef({ color, width });
  useEffect(() => {
    styleRef.current = { color, width };
  }, [color, width]);

  const discard = useCallback(() => {
    for (const run of runsRef.current) if (run.line) disposeStrokeLine(run.line);
    runsRef.current = [];
    openRef.current = false;
    lastScreenRef.current = null;
  }, []);

  /** Reconstruit la ligne d'aperçu de la portion en cours (WYSIWYG : le trait final, déjà). */
  const refresh = useCallback((handle: PaintSceneHandle, lines: LineModules, run: Run) => {
    if (run.samples.length < 2) return;
    if (run.line) disposeStrokeLine(run.line);
    const normal = runNormal(run.samples);
    run.line = buildStrokeLine(handle, lines, {
      type: 'splat-paint',
      points: flattenObject(run.samples),
      color: styleRef.current.color,
      width: styleRef.current.width,
      ...(normal ? { normal } : {}),
    });
    handle.mesh.add(run.line);
  }, []);

  const begin = useCallback(() => discard(), [discard]);

  const sample = useCallback(
    (point: [number, number], viewport: Viewport) => {
      const handle = getSceneHandle();
      if (!handle) return false;
      const previous = lastScreenRef.current;
      const step = previous ? Math.hypot(point[0] - previous[0], point[1] - previous[1]) : 0;
      lastScreenRef.current = point;
      const hit = raycastSurface(handle, point, viewport, step);
      if (!hit) {
        openRef.current = false; // rayon dans le vide : la portion s'arrête ici
        return false;
      }
      const open = openRef.current ? runsRef.current[runsRef.current.length - 1] : undefined;
      const last = open?.samples[open.samples.length - 1];
      if (last && breaksRun(last, hit, { fovDeg: handle.camera.fov, height: viewport.height }))
        openRef.current = false;
      if (!openRef.current) {
        runsRef.current.push({ samples: [], line: null });
        openRef.current = true;
      }
      const run = runsRef.current[runsRef.current.length - 1];
      run.samples.push(hit);
      const lines = getLines();
      if (lines) refresh(handle, lines, run);
      return true;
    },
    [getSceneHandle, getLines, refresh],
  );

  const end = useCallback(() => {
    const strokes: SplatPaintStroke[] = [];
    for (const run of runsRef.current) {
      if (run.line) disposeStrokeLine(run.line);
      if (run.samples.length < 2) continue; // un point isolé n'est pas un trait
      const normal = runNormal(run.samples);
      strokes.push({
        type: 'splat-paint',
        points: flattenObject(run.samples),
        color: styleRef.current.color,
        width: styleRef.current.width,
        ...(normal ? { normal } : {}),
      });
    }
    runsRef.current = [];
    openRef.current = false;
    lastScreenRef.current = null;
    if (strokes.length > 0) onStrokes(strokes);
  }, [onStrokes]);

  // Démontage : l'aperçu ne doit pas survivre à la scène qui le porte.
  useEffect(() => discard, [discard]);

  return { begin, sample, end, cancel: discard };
}
