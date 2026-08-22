// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useT } from '../../i18n';

/**
 * Ce qu'un invité doit lire quand un média ne s'ouvre pas. Les messages internes
 * (« relancer la conversion », « re-téléverser un GLB ») s'adressent à un artiste et n'ont
 * aucun sens pour le client : on lui dit ce qu'il peut faire, c'est-à-dire écrire au studio.
 */
export default function ClientUnavailable() {
  const t = useT();
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-background/80 p-6">
      <p className="max-w-sm text-center text-sm text-muted-foreground">
        {t('client.mediaUnavailable')}
        <br />
        {t('client.contactStudio')}
      </p>
    </div>
  );
}
