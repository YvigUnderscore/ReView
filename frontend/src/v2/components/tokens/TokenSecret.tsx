// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Copy } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import { useT } from '../../i18n';

/**
 * Le secret d'un token, montré une seule fois.
 *
 * Le serveur ne stocke qu'un hachage : ce qui s'affiche ici n'existe nulle part ailleurs.
 * D'où l'avertissement systématique — un token perdu se remplace, il ne se retrouve pas.
 */
export default function TokenSecret({ secret }: { secret: string }) {
  const t = useT();
  return (
    <div className="space-y-1 rounded-md border border-primary/40 bg-primary/10 px-3 py-2">
      <p className="text-xs font-medium text-primary">{t('tokens.secretOnce')}</p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate text-xs">{secret}</code>
        <Button
          variant="ghost"
          size="sm"
          title={t('tokens.copy')}
          onClick={async () => {
            await navigator.clipboard.writeText(secret);
            toast.success(t('tokens.copied'));
          }}
        >
          <Copy size={14} />
        </Button>
      </div>
    </div>
  );
}
