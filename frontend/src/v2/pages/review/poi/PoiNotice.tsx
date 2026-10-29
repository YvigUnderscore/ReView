// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useT } from '../../../i18n';

/**
 * The "the viewer awaits a click" banner of the two spatial viewers. The 3D model had one, the splat had
 * none: this is one of the reasons why one "could not" place a point on a cloud, since nothing said that
 * placement was armed.
 */
export default function PoiNotice({ count }: { count: number }) {
  const t = useT();
  return (
    <p className="absolute top-2 left-1/2 z-20 -translate-x-1/2 rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground shadow-lg">
      {count > 0 ? t('poi.clickToPlaceNext', { n: count + 1 }) : t('hotspot.clickToPlace')}
    </p>
  );
}
