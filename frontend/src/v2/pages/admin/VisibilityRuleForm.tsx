// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Select } from '../../components/ui/select';
import {
  useCreateRule,
  type ApplyResult,
  type MatchType,
  type VisibilityEntityType,
} from '../../lib/visibilityApi';
import { MATCH_EXAMPLE, MATCH_LABEL, TYPE_LABEL } from './visibilityLabels';
import { useT } from '../../i18n';

/**
 * Écriture d'une règle de masquage.
 *
 * Le serveur refuse une expression invalide **ou trop lente** : ces deux refus arrivent ici,
 * au moment où l'admin peut corriger. Plus tard, la règle paraîtrait active sans rien
 * masquer, et personne ne saurait pourquoi.
 */
const ENTITY_TYPES: VisibilityEntityType[] = ['all', 'episode', 'sequence', 'shot', 'asset'];
const MATCH_TYPES: MatchType[] = ['exact', 'prefix', 'contains', 'regex'];

export default function VisibilityRuleForm({
  onClose,
  onApplied,
}: {
  onClose: () => void;
  onApplied: (applied: ApplyResult) => void;
}) {
  const t = useT();
  const create = useCreateRule();
  const [entityType, setEntityType] = useState<VisibilityEntityType>('shot');
  const [matchType, setMatchType] = useState<MatchType>('contains');
  const [pattern, setPattern] = useState('');
  const [ignoreCase, setIgnoreCase] = useState(true);
  const [reason, setReason] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    create.mutate(
      { entityType, matchType, pattern, ignoreCase, reason: reason || null },
      {
        onSuccess: (r) => {
          onApplied(r.applied);
          onClose();
        },
        onError: (err: unknown) =>
          toast.error(err instanceof Error ? err.message : t('common.error.generic')),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="space-y-3">
          <DialogHeader>
            <DialogTitle>{t('visibility.newRule')}</DialogTitle>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>{t('visibility.form.entityType')}</Label>
              <Select
                className="w-full"
                value={entityType}
                onChange={(e) => setEntityType(e.target.value as VisibilityEntityType)}
              >
                {ENTITY_TYPES.map((value) => (
                  <option key={value} value={value}>
                    {t(TYPE_LABEL[value])}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <Label>{t('visibility.form.matchType')}</Label>
              <Select
                className="w-full"
                value={matchType}
                onChange={(e) => setMatchType(e.target.value as MatchType)}
              >
                {MATCH_TYPES.map((value) => (
                  <option key={value} value={value}>
                    {t(MATCH_LABEL[value])}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className="space-y-1">
            <Label>{t('visibility.form.pattern')}</Label>
            <Input
              autoFocus
              required
              value={pattern}
              placeholder={t(MATCH_EXAMPLE[matchType])}
              aria-label={t(MATCH_EXAMPLE[matchType])}
              onChange={(e) => setPattern(e.target.value)}
              className="font-mono"
            />
            <p className="text-2xs text-muted-foreground">{t('visibility.form.patternHint')}</p>
          </div>

          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={ignoreCase} onChange={(e) => setIgnoreCase(e.target.checked)} />
            {t('visibility.form.ignoreCase')}
          </label>

          <div className="space-y-1">
            <Label>{t('visibility.form.reason')}</Label>
            <Input
              value={reason}
              placeholder={t('visibility.form.reasonHint')}
              aria-label={t('visibility.form.reasonHint')}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" size="sm" disabled={create.isPending}>
              {t('common.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
