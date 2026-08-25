// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { EyeOff, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import ConfirmDialog from '../../components/ConfirmDialog';
import EmptyState from '../../components/ui/empty-state';
import { Button } from '../../components/ui/button';
import { SkeletonRows } from '../../components/ui/skeleton';
import VisibilityRuleForm from './VisibilityRuleForm';
import VisibilityHelp from './VisibilityHelp';
import {
  useApplyRules,
  useDeleteRule,
  useUpdateRule,
  useVisibilityRules,
  type VisibilityRule,
} from '../../lib/visibilityApi';
import { MATCH_LABEL, TYPE_LABEL } from './visibilityLabels';
import { useT } from '../../i18n';

/**
 * Masquage d'éléments (admin).
 *
 * Un studio traîne toujours dans son registre de production des séquences de test, des
 * plans « _TMP » et des assets de recette que personne ne veut voir. Les mettre à la
 * corbeille les ferait revenir à la synchronisation suivante — et perdrait leur travail.
 * Une règle est donc déclarative et rejouée : elle vaut pour ce qui existe comme pour ce
 * qui arrivera.
 */
export default function VisibilityTab() {
  const t = useT();
  const { data: rules = [], isLoading } = useVisibilityRules();
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<VisibilityRule | null>(null);
  const remove = useDeleteRule();
  const update = useUpdateRule();
  const apply = useApplyRules();

  /** Le compte rendu d'un recalcul : combien masqués, combien rendus. */
  const report = (applied: { hidden: number; revealed: number }) =>
    toast.success(t('visibility.applied', { hidden: applied.hidden, revealed: applied.revealed }));

  const confirmDelete = () => {
    if (!deleting) return;
    remove.mutate(deleting.id, {
      onSuccess: (r) => {
        report(r.applied);
        setDeleting(null);
      },
      onError: (e: unknown) => toast.error(e instanceof Error ? e.message : t('common.error.generic')),
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">{t('visibility.title')}</h2>
          <p className="text-xs text-muted-foreground">{t('visibility.lead')}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={apply.isPending}
            onClick={() => apply.mutate(undefined, { onSuccess: (r) => report(r.applied) })}
          >
            <RefreshCw size={14} /> {t('visibility.apply')}
          </Button>
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus size={16} /> {t('visibility.newRule')}
          </Button>
        </div>
      </div>

      <VisibilityHelp />

      {isLoading ? (
        <SkeletonRows count={3} />
      ) : rules.length === 0 ? (
        <EmptyState
          compact
          icon={EyeOff}
          title={t('visibility.empty.title')}
          description={t('visibility.empty.description')}
        />
      ) : (
        <ul className="space-y-1.5">
          {rules.map((rule) => (
            <li
              key={rule.id}
              className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-card px-3 py-2"
            >
              <span className="rounded bg-secondary px-1.5 py-0.5 text-2xs uppercase tracking-wide text-muted-foreground">
                {t(TYPE_LABEL[rule.entityType])}
              </span>
              <span className="text-2xs text-muted-foreground">{t(MATCH_LABEL[rule.matchType])}</span>
              <code className="rounded bg-secondary/60 px-1.5 py-0.5 font-mono text-xs">{rule.pattern}</code>
              {rule.projectId === null && (
                <span className="text-2xs text-muted-foreground">{t('visibility.scope.studio')}</span>
              )}
              {rule.reason && <span className="truncate text-xs text-muted-foreground">{rule.reason}</span>}
              <span className="ml-auto flex items-center gap-2">
                <label className="flex items-center gap-1.5 text-2xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={rule.enabled}
                    onChange={(e) =>
                      update.mutate(
                        { id: rule.id, enabled: e.target.checked },
                        { onSuccess: (r) => report(r.applied) },
                      )
                    }
                  />
                  {t('visibility.enabled')}
                </label>
                <button
                  onClick={() => setDeleting(rule)}
                  title={t('common.delete')}
                  aria-label={t('common.delete')}
                  className="rounded p-1 text-destructive hover:bg-secondary"
                >
                  <Trash2 size={14} />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {creating && <VisibilityRuleForm onClose={() => setCreating(false)} onApplied={report} />}

      <ConfirmDialog
        open={!!deleting}
        title={t('visibility.delete.title')}
        message={t('visibility.delete.message')}
        confirmLabel={t('common.delete')}
        danger
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
