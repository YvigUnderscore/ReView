// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Bell, BellOff } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { pushSupported, currentSubscription, enablePush, disablePush } from '../../lib/webpush';
import { useT } from '../../i18n';

/** Bascule des notifications Web Push du navigateur courant (42.B — №66). */
export default function PushToggle() {
  const t = useT();
  const supported = pushSupported();
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (supported) void currentSubscription().then((s) => setEnabled(!!s));
  }, [supported]);

  if (!supported) {
    return <p className="text-xs text-muted-foreground">{t('push.unsupported')}</p>;
  }

  const toggle = async () => {
    setBusy(true);
    try {
      if (enabled) {
        await disablePush();
        setEnabled(false);
        toast.success(t('push.disabled'));
      } else {
        await enablePush();
        setEnabled(true);
        toast.success(t('push.enabled'));
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('common.error.generic'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <div className="text-sm">{t('push.title')}</div>
        <div className="text-xs text-muted-foreground">{t('push.hint')}</div>
      </div>
      <Button variant={enabled ? 'secondary' : 'default'} size="sm" onClick={toggle} disabled={busy}>
        {enabled ? <BellOff size={14} /> : <Bell size={14} />}
        {enabled ? t('common.disable') : t('common.enable')}
      </Button>
    </div>
  );
}
