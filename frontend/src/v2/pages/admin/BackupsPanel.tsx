// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { HardDriveDownload, KeyRound, ShieldCheck } from 'lucide-react';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Tooltip } from '../../components/ui/tooltip';
import { useT, intlLocale } from '../../i18n';
import { Panel } from './AdminPrimitives';
import { fmtBytes } from './adminShared';
import CommandBlock from './CommandBlock';
import type { BackupCatalog, BackupEntry, Mechanism } from './ops';
import { Hint } from '../../components/ui/hint';

/**
 * The backups taken by `scripts/backup.sh`, and the two safe actions one can apply to them:
 * create one, verify one.
 *
 * **Restoring is not here, and that is deliberate.** `restore.sh db|all` overwrites the database
 * without confirmation and without a terminal; the screen shows its command, ready to paste,
 * rather than making it a button. The `verify` mode, on the other hand, is non-destructive: it loads the dump
 * into a throwaway database and counts what comes out of it.
 */
export default function BackupsPanel({
  catalog,
  mechanism,
  onCreate,
  onCheck,
  busy,
}: {
  catalog: BackupCatalog;
  mechanism: Mechanism;
  onCreate: () => void;
  onCheck: (id: string) => void;
  busy: boolean;
}) {
  const t = useT();
  const canRun = mechanism.state === 'ready';

  return (
    <Panel title={t('ops.backups.title')}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">
          {catalog.available ? t('ops.backups.count', { count: catalog.entries.length }) : '—'}
        </span>
        {catalog.available && canRun && mechanism.allow.backup && (
          <Button variant="outline" size="sm" className="ml-auto" disabled={busy} onClick={onCreate}>
            <HardDriveDownload size={13} /> {t('ops.backups.create')}
          </Button>
        )}
      </div>

      {!catalog.available && <p className="text-sm text-muted-foreground">{t('ops.backups.unavailable')}</p>}

      {catalog.available && catalog.entries.length === 0 && (
        <p className="text-sm text-muted-foreground">{t('ops.backups.empty')}</p>
      )}

      {catalog.entries.length > 0 && (
        <ul className="space-y-2">
          {catalog.entries.map((entry) => (
            <BackupRow
              key={entry.id}
              entry={entry}
              canCheck={canRun && mechanism.allow.verify}
              busy={busy}
              onCheck={() => onCheck(entry.id)}
            />
          ))}
        </ul>
      )}

      {catalog.entries.length > 0 && (
        <div className="mt-4 space-y-2 border-t border-border pt-3">
          <Hint>{t('ops.backups.restoreHint')}</Hint>
          <CommandBlock command={catalog.entries[0].restoreCommand} />
        </div>
      )}
    </Panel>
  );
}

function BackupRow({
  entry,
  canCheck,
  busy,
  onCheck,
}: {
  entry: BackupEntry;
  canCheck: boolean;
  busy: boolean;
  onCheck: () => void;
}) {
  const t = useT();
  const taken = entry.date ? new Date(entry.date) : null;
  const when =
    taken && !Number.isNaN(taken.getTime())
      ? taken.toLocaleString(intlLocale(), { dateStyle: 'medium', timeStyle: 'short' })
      : entry.id;

  return (
    <li className="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
      <code className="font-mono text-xs">{entry.id}</code>
      <span className="text-muted-foreground">{when}</span>
      {entry.dbBytes !== null && (
        // `value` and not `count`: it is an already formatted size, not a plural.
        <span className="text-xs text-muted-foreground">
          {t('ops.backups.dump', { value: fmtBytes(entry.dbBytes) })}
        </span>
      )}
      {entry.fromRelease && (
        <span className="text-xs text-muted-foreground">
          {t('ops.backups.taken', { tag: entry.fromRelease })}
        </span>
      )}
      {/* Without the secrets, the encrypted rows of a restore elsewhere are unreadable:
          the information is worth carrying on the row, not burying in a help page. */}
      <Tooltip label={entry.envIncluded ? t('ops.backups.secrets') : t('ops.backups.noSecrets')}>
        <Badge variant={entry.envIncluded ? 'muted' : 'warning'}>
          <KeyRound size={11} aria-hidden />
        </Badge>
      </Tooltip>
      {canCheck && (
        <Tooltip label={t('ops.backups.checkHint')}>
          <Button variant="ghost" size="sm" className="ml-auto" disabled={busy} onClick={onCheck}>
            <ShieldCheck size={13} /> {t('ops.backups.check')}
          </Button>
        </Tooltip>
      )}
    </li>
  );
}
