// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef, useState } from 'react';
import { useColorGrade } from './useColorGrade';
import { resolveDisplayView, type ProjectColor } from './colorSettings';
import { useDisplayLut, useOcioDisplays, useSourceImage } from './colorQueries';
import { canvasToObjectUrl, renderTransform } from './renderTransform';

/**
 * Transformée d'affichage d'une image de review : lit les réglages du lecteur, récupère la
 * LUT du couple display/view du projet, applique le tout au GPU et rend une **image
 * transformée superposée** à l'originale dans le plan zoomé du viewer.
 *
 * Pourquoi une superposition plutôt qu'un remplacement de la source : la visionneuse refait
 * son cadrage à chaque changement de `src` (elle remet `base` à zéro). Remplacer la source
 * remettrait le zoom et le pan à plat à chaque cran d'exposition. La superposition laisse la
 * visionneuse, ses annotations, ses références épinglées et la synchro de session intactes.
 */

export interface DisplayTransform {
  /** URL de l'image transformée à superposer, ou `null` (rien à superposer). */
  url: string | null;
}

/**
 * Ce que le hook **ne** rend pas : l'état de la cuisson. Le panneau Color le lit lui-même
 * (même clé de requête, donc même réponse, sans un appel de plus) et l'absence de WebGL
 * passe par le store — le viewer n'a rien à afficher, il n'a besoin que d'une image.
 */

/** Délai avant re-rendu : scruber l'exposition ne doit pas lancer un encodage par pixel bougé. */
const RENDER_DEBOUNCE_MS = 140;

export function useDisplayTransform(src: string, projectColor: ProjectColor | null): DisplayTransform {
  const settings = useColorGrade((s) => s.settings);
  const displaysQuery = useOcioDisplays(projectColor?.configId);
  const target = resolveDisplayView(settings, projectColor, displaysQuery.data ?? []);

  const lutQuery = useDisplayLut(target, settings.enabled);
  const lut = settings.enabled ? (lutQuery.data?.lut ?? null) : null;
  const graded = settings.exposure !== 0 || settings.gamma !== 1;
  const wanted = settings.enabled && (!!lut || graded);

  const imageQuery = useSourceImage(src, wanted);
  const markUnsupported = useColorGrade((s) => s.markUnsupported);
  const [url, setUrl] = useState<string | null>(null);
  const held = useRef<string | null>(null);

  const publish = (next: string | null): void => {
    const prev = held.current;
    held.current = next;
    setUrl(next);
    // Le navigateur garde vivante l'image déjà décodée : révoquer l'ancienne URL
    // immédiatement ne fait pas clignoter l'affichage, et libère le blob.
    if (prev) URL.revokeObjectURL(prev);
  };

  const image = imageQuery.data ?? null;
  const { exposure, gamma } = settings;

  useEffect(() => {
    let cancelled = false;
    // Tout passe par le délai, y compris l'effacement : poser l'état pendant le corps de
    // l'effet enchaînerait un rendu de plus à chaque cran d'exposition.
    const timer = setTimeout(() => {
      if (!wanted || !image) {
        publish(null);
        return;
      }
      const result = renderTransform(image, image.naturalWidth, image.naturalHeight, {
        exposure,
        gamma,
        lut,
      });
      if (!result) {
        markUnsupported();
        return;
      }
      void canvasToObjectUrl(result.canvas).then((objectUrl) => {
        if (cancelled || !objectUrl) {
          if (objectUrl) URL.revokeObjectURL(objectUrl);
          return;
        }
        publish(objectUrl);
      });
    }, RENDER_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // `publish` est stable (refs + setState) ; la liste porte tout ce qui change l'image.
  }, [wanted, image, exposure, gamma, lut, markUnsupported]);

  // Dernière URL libérée au démontage : sans cela un aller-retour dans la review fuit un blob
  // par média visité.
  useEffect(
    () => () => {
      if (held.current) URL.revokeObjectURL(held.current);
      held.current = null;
    },
    [],
  );

  // L'image superposée est **dérivée** : dès que la transformée n'a plus lieu d'être, elle
  // disparaît au rendu courant, sans attendre que l'effet ait libéré le blob.
  return { url: wanted ? url : null };
}
