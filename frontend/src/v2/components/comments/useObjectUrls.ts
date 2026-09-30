// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useMemo } from 'react';

/**
 * Une URL `blob:` par fichier en attente, dans le même ordre — de quoi montrer une vignette
 * de ce qu'on est en train de joindre.
 *
 * Les URL naissent dans le `useMemo` et meurent dans le nettoyage de l'effet qui en dépend :
 * si React jette le mémo et le recalcule, l'effet se rejoue et révoque exactement le lot
 * qu'il avait reçu. Un blob non révoqué retiendrait son fichier en mémoire pour toute la
 * durée de l'onglet.
 */
export function useObjectUrls(files: readonly File[]): string[] {
  const urls = useMemo(() => files.map((file) => URL.createObjectURL(file)), [files]);
  useEffect(() => () => urls.forEach((url) => URL.revokeObjectURL(url)), [urls]);
  return urls;
}
