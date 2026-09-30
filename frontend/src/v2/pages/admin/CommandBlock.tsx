// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { useT } from '../../i18n';

/**
 * Une commande de terminal, recopiable d'un clic.
 *
 * C'est la pièce qui rend l'écran utile quand l'instance ne sait pas agir sur elle-même :
 * plutôt qu'un bouton grisé — qui fait croire à une panne et n'apprend rien —, on donne la
 * commande exacte, prête à coller dans le terminal de la machine qui héberge l'instance.
 *
 * Le texte est du `<pre>` : c'est ainsi qu'on déclare qu'il ne se traduit pas
 * (`scripts/check-untranslated.mjs`), et c'est vrai — une commande shell n'a pas de langue.
 */
export default function CommandBlock({ command }: { command: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);

  const copy = () => {
    // `clipboard` peut manquer (contexte non sécurisé, permission refusée) : on n'annonce
    // « copié » que si la copie a réellement eu lieu. La commande reste sélectionnable.
    navigator.clipboard
      ?.writeText(command)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => setCopied(false));
  };

  return (
    <div className="flex items-start gap-2">
      <pre className="min-w-0 flex-1 overflow-x-auto rounded-md bg-secondary px-3 py-2 font-mono text-xs">
        {command}
      </pre>
      <Button variant="outline" size="sm" onClick={copy} aria-label={t('ops.copy')}>
        {copied ? <Check size={13} /> : <Copy size={13} />}
        {copied ? t('ops.copied') : t('ops.copy')}
      </Button>
    </div>
  );
}
