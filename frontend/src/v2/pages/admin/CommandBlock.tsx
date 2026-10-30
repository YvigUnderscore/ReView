// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { useT } from '../../i18n';

/**
 * A terminal command, copyable with one click.
 *
 * This is the piece that makes the screen useful when the instance cannot act on itself:
 * rather than a greyed-out button — which suggests a fault and teaches nothing — it gives the
 * exact command, ready to paste into the terminal of the machine hosting the instance.
 *
 * The text is in a `<pre>`: that is how one declares that it is not translated
 * (`scripts/check-untranslated.mjs`), and it is true — a shell command has no language.
 */
export default function CommandBlock({ command }: { command: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);

  const copy = () => {
    // `clipboard` may be missing (insecure context, permission denied): we only announce
    // "copied" if the copy actually happened. The command stays selectable.
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
