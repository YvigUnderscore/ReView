// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef, useState } from 'react';
import { resolveDisplayView, type ProjectColor } from './colorSettings';
import { useDisplayLut, useOcioDisplays, useSourceImage } from './colorQueries';
import { canvasToObjectUrl, renderTransform } from './renderTransform';

/**
 * Transformée d'affichage d'une image de review : récupère la LUT du couple display/view **du
 * projet**, l'applique au GPU et rend une **image transformée superposée** à l'originale dans
 * le plan zoomé du viewer.
 *
 * Il n'y a plus de réglage au moment de la review (Phase 50) : la gestion couleur est celle du
 * studio, définie dans les paramètres du projet. Le hook n'a donc plus d'état à lire — la
 * config du projet suffit à décider ce qui s'affiche.
 *
 * Pourquoi une superposition plutôt qu'un remplacement de la source : la visionneuse refait
 * son cadrage à chaque changement de `src` (elle remet `base` à zéro). Remplacer la source
 * remettrait le zoom et le pan à plat. La superposition laisse la visionneuse, ses
 * annotations, ses références épinglées et la synchro de session intactes.
 */

export interface DisplayTransform {
  /** URL de l'image transformée à superposer, ou `null` (rien à superposer). */
  url: string | null;
}

/** Délai avant re-rendu : un changement de média ne doit pas lancer deux encodages. */
const RENDER_DEBOUNCE_MS = 140;

export function useDisplayTransform(src: string, projectColor: ProjectColor | null): DisplayTransform {
  const displaysQuery = useOcioDisplays(projectColor?.configId);
  const target = resolveDisplayView(projectColor, displaysQuery.data ?? []);

  const lutQuery = useDisplayLut(target);
  // Sans LUT cuite, il n'y a rien à appliquer : l'image d'origine est déjà la bonne réponse.
  const lut = lutQuery.data?.lut ?? null;

  const imageQuery = useSourceImage(src, !!lut);
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

  useEffect(() => {
    let cancelled = false;
    // Tout passe par le délai, y compris l'effacement : poser l'état pendant le corps de
    // l'effet enchaînerait un rendu de plus à chaque changement de média.
    const timer = setTimeout(() => {
      if (!lut || !image) {
        publish(null);
        return;
      }
      const result = renderTransform(image, image.naturalWidth, image.naturalHeight, lut);
      // Navigateur sans WebGL : on rend l'image d'origine plutôt qu'une superposition périmée.
      if (!result) {
        publish(null);
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
  }, [image, lut]);

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
  return { url: lut ? url : null };
}
