// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useT } from '../../../i18n';

/**
 * Bandeau « le viewer attend un clic » des deux viewers spatiaux. Le modèle 3D en avait un, le
 * splat n'en avait aucun : c'est une des raisons pour lesquelles on ne « n'arrivait pas » à
 * poser un point sur un nuage — rien ne disait que le placement était armé.
 */
export default function PoiNotice({ count }: { count: number }) {
  const t = useT();
  return (
    <p className="absolute top-2 left-1/2 z-20 -translate-x-1/2 rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground shadow-lg">
      {count > 0 ? t('poi.clickToPlaceNext', { n: count + 1 }) : t('hotspot.clickToPlace')}
    </p>
  );
}
