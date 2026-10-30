// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useT } from '../../i18n';

/**
 * What a guest must read when a media fails to open. Internal messages ("re-run the
 * conversion", "re-upload a GLB") address an artist and mean nothing to the client, so we
 * tell them what they can do instead: write to the studio.
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
