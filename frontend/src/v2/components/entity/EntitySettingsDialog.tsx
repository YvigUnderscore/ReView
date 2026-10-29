// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import PipelineStatusSelect from '../shotgrid/PipelineStatusSelect';
import EntityThumbnailField from './EntityThumbnailField';
import EntityDepartmentsField from './EntityDepartmentsField';
import EntityPipelineField from './EntityPipelineField';
import { formFromOverride, overrideFromForm, type PipelineForm } from '../../pages/project/pipelineForm';
import { useSetEntityDepartments } from '../../lib/departmentsApi';
import { useUpdateEntity } from '../../lib/entityApi';
import {
  ENTITY_FIELDS,
  ENTITY_SEGMENT,
  departmentsChanged,
  formError,
  formFromEntity,
  payloadFromForm,
  type EntityKind,
  type EntitySource,
} from './entitySettings';
import type { PipelineOverride, PipelineSettings } from '../../types/api';
import { useT, type MessageKey } from '../../i18n';

/**
 * Settings of a sequence, shot or asset (C3), in a single panel.
 *
 * Each entity used to have its own edit box, with different fields for no reason: no description or thumbnail on
 * a sequence, no status on a shot, no type label on an asset. This panel opens from the right-click menu or from
 * the palette; it only shows the fields the entity actually has, and only sends what changed.
 */

/**
 * Starting base of the pipeline form, until the project settings arrive. It only pre-fills the fields in
 * "customize" mode; in "inherit" mode, the project's real values are displayed and the override sent is empty.
 */
const PLACEHOLDER_INHERITED: PipelineSettings = { resolution: { width: 1920, height: 1080 }, framerate: 24 };

const TITLE_KEY: Record<EntityKind, MessageKey> = {
  sequence: 'entity.settings.title.sequence',
  shot: 'entity.settings.title.shot',
  asset: 'entity.settings.title.asset',
};

export default function EntitySettingsDialog({
  kind,
  id,
  projectId,
  entity,
  thumbnailUrl,
  sequenceOverride,
  onClose,
  onSaved,
}: {
  kind: EntityKind;
  id: number;
  projectId: number;
  entity: EntitySource & { settings?: PipelineOverride };
  thumbnailUrl?: string | null;
  /** Settings of the owning sequence, which a shot inherits. */
  sequenceOverride?: PipelineOverride;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const t = useT();
  const [initial] = useState(() => formFromEntity(entity));
  const [values, setValues] = useState(initial);
  // The inherited base is only known once the project settings request returns, so the form starts from the
  // override itself, and `EntityPipelineField` displays the real inherited value.
  const [pipe, setPipe] = useState<PipelineForm>(() =>
    formFromOverride(entity.settings, PLACEHOLDER_INHERITED),
  );
  const [error, setError] = useState<string | null>(null);
  const update = useUpdateEntity(kind, id, projectId);
  const setDepartments = useSetEntityDepartments(projectId, ENTITY_SEGMENT[kind], id);
  const fields = ENTITY_FIELDS[kind];
  const set = <K extends keyof typeof values>(key: K, value: (typeof values)[K]) =>
    setValues((v) => ({ ...v, [key]: value }));

  const busy = update.isPending || setDepartments.isPending;

  const save = async () => {
    const invalid = formError(kind, values);
    if (invalid) {
      setError(t(invalid === 'name' ? 'entity.settings.nameRequired' : 'entity.settings.codeRequired'));
      return;
    }
    setError(null);
    const payload = payloadFromForm(kind, initial, values);
    // Pipeline settings are only sent if the entity owns some: an asset has neither its own resolution
    // nor its own frame rate.
    if (fields.has('pipelineStatusId')) {
      payload.settings = overrideFromForm(pipe, PLACEHOLDER_INHERITED);
    }
    try {
      if (Object.keys(payload).length > 0) await update.mutateAsync(payload);
      if (departmentsChanged(initial, values)) await setDepartments.mutateAsync(values.departmentIds);
      toast.success(t('entity.settings.saved'));
      onSaved?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error.generic'));
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t(TITLE_KEY[kind])}</DialogTitle>
        </DialogHeader>
        {error && <p className="mb-2 text-xs text-destructive">{error}</p>}

        <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
          <div className="flex gap-2">
            {fields.has('code') && (
              <div className="w-32 space-y-1">
                <Label htmlFor="entity-code">{t('entity.settings.code')}</Label>
                <Input id="entity-code" value={values.code} onChange={(e) => set('code', e.target.value)} />
              </div>
            )}
            <div className="flex-1 space-y-1">
              <Label htmlFor="entity-name">{t('common.name')}</Label>
              <Input id="entity-name" value={values.name} onChange={(e) => set('name', e.target.value)} />
            </div>
          </div>

          {fields.has('typeLabel') && (
            <div className="space-y-1">
              <Label htmlFor="entity-type">{t('entity.settings.typeLabel')}</Label>
              <Input
                id="entity-type"
                value={values.typeLabel}
                placeholder={t('entity.settings.typeLabelPlaceholder')}
                onChange={(e) => set('typeLabel', e.target.value)}
              />
            </div>
          )}

          <div className="space-y-1">
            <Label htmlFor="entity-description">{t('entity.settings.description')}</Label>
            <Textarea
              id="entity-description"
              autoGrow
              minRows={2}
              maxRows={8}
              value={values.description}
              onChange={(e) => set('description', e.target.value)}
            />
          </div>

          {fields.has('startFrame') && (
            <div className="flex gap-2">
              <div className="flex-1 space-y-1">
                <Label htmlFor="entity-start">{t('shot.startFrame')}</Label>
                <Input
                  id="entity-start"
                  inputMode="numeric"
                  value={values.startFrame}
                  onChange={(e) => set('startFrame', e.target.value)}
                />
              </div>
              <div className="flex-1 space-y-1">
                <Label htmlFor="entity-end">{t('shot.endFrame')}</Label>
                <Input
                  id="entity-end"
                  inputMode="numeric"
                  value={values.endFrame}
                  onChange={(e) => set('endFrame', e.target.value)}
                />
              </div>
            </div>
          )}

          {fields.has('pipelineStatusId') && (
            <div className="space-y-1">
              <Label htmlFor="entity-status">{t('entity.settings.status')}</Label>
              <div>
                <PipelineStatusSelect
                  projectId={projectId}
                  scope={kind === 'sequence' ? 'sequence' : 'shot'}
                  statusId={values.pipelineStatusId}
                  onChange={({ statusId }) => set('pipelineStatusId', statusId)}
                  className="px-2 py-1.5 text-sm"
                />
              </div>
            </div>
          )}

          {fields.has('pipelineStatusId') && (
            <div className="space-y-1">
              <Label>{t('pipeline.title')}</Label>
              <EntityPipelineField
                projectId={projectId}
                sequenceOverride={sequenceOverride}
                form={pipe}
                onChange={setPipe}
                idPrefix={`${kind}-${id}`}
              />
            </div>
          )}

          <div className="space-y-1">
            <Label>{t('entity.settings.thumbnail')}</Label>
            <EntityThumbnailField kind={kind} id={id} projectId={projectId} url={thumbnailUrl} />
          </div>

          <div className="space-y-1">
            <Label>{t('entity.settings.departments')}</Label>
            <EntityDepartmentsField
              projectId={projectId}
              value={values.departmentIds}
              onChange={(next) => set('departmentIds', next)}
              disabled={busy}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button size="sm" onClick={() => void save()} disabled={busy}>
            {busy ? t('common.saving') : t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
