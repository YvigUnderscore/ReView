// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Sonde d'URL du routeur mémoire.
 *
 * Monté par `renderWithProviders`, il rapporte l'URL courante à chaque navigation — c'est
 * ainsi qu'un test constate qu'une connexion réussie a bien quitté `/login`, ou qu'un
 * onglet s'est bien écrit dans la query-string. Fichier séparé parce qu'il ne doit rien
 * exporter d'autre qu'un composant (rechargement à chaud).
 */
export function LocationSpy({ onChange }: { onChange: (path: string) => void }) {
  const location = useLocation();
  useEffect(() => {
    onChange(`${location.pathname}${location.search}`);
  }, [location, onChange]);
  return null;
}
