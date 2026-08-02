// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Select } from '../../components/ui/select';
import { Textarea } from '../../components/ui/textarea';
import { ROLES } from './adminShared';
import type { Announcement, AnnouncementFrequency, AnnouncementType, Role } from '../../types/api';
import { useT, type MessageKey } from '../../i18n';

/** Traducteur passé aux tables de libellés, recalculées à chaque rendu. */
type Tr = (key: MessageKey) => string;

/** ISO → valeur `datetime-local` (heure locale) ; '' si absent. */
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const fromLocalInput = (v: string): string | null => (v ? new Date(v).toISOString() : null);

const TYPES: AnnouncementType[] = ['INFO', 'WARNING', 'MAINTENANCE'];
const freqs = (t: Tr): { value: AnnouncementFrequency; label: string }[] => [
  { value: 'PERMANENT', label: t('announcement.scope.permanent') },
  { value: 'FIRST_LOGIN', label: t('announcement.scope.firstLogin') },
  { value: 'FIRST_OF_DAY', label: t('announcement.scope.firstDaily') },
];

/** Création / édition d'une annonce (admin). */
export default function AnnouncementForm({
  announcement,
  onClose,
  onSaved,
}: {
  announcement: Announcement | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useT();
  const [f, setF] = useState({
    title: announcement?.title ?? '',
    body: announcement?.body ?? '',
    type: announcement?.type ?? ('INFO' as AnnouncementType),
    frequency: announcement?.frequency ?? ('PERMANENT' as AnnouncementFrequency),
    roles: announcement?.roles ?? ([] as Role[]),
    startsAt: toLocalInput(announcement?.startsAt ?? null),
    endsAt: toLocalInput(announcement?.endsAt ?? null),
    active: announcement?.active ?? true,
  });
  const [busy, setBusy] = useState(false);

  const toggleRole = (r: Role) =>
    setF((s) => ({ ...s, roles: s.roles.includes(r) ? s.roles.filter((x) => x !== r) : [...s.roles, r] }));

  const save = async () => {
    if (!f.title.trim() || !f.body.trim()) return toast.error(t('announcement.required'));
    setBusy(true);
    const payload = {
      title: f.title,
      body: f.body,
      type: f.type,
      frequency: f.frequency,
      roles: f.roles,
      startsAt: fromLocalInput(f.startsAt),
      endsAt: fromLocalInput(f.endsAt),
      active: f.active,
    };
    try {
      if (announcement) await api.patch(`/api/announcements/${announcement.id}`, payload);
      else await api.post('/api/announcements', payload);
      toast.success(announcement ? t('admin.announce.updated') : t('admin.announce.created'));
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Enregistrement impossible');
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{announcement ? t('admin.announce.edit') : t('admin.announce.new')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <Input
            placeholder={t('editor.heading')}
            value={f.title}
            onChange={(e) => setF((s) => ({ ...s, title: e.target.value }))}
          />
          <Textarea
            autoGrow
            minRows={3}
            placeholder={t('announcement.body')}
            value={f.body}
            onChange={(e) => setF((s) => ({ ...s, body: e.target.value }))}
          />
          <div className="flex flex-wrap gap-2">
            <Select
              value={f.type}
              onChange={(e) => setF((s) => ({ ...s, type: e.target.value as AnnouncementType }))}
            >
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
            <Select
              className="flex-1"
              value={f.frequency}
              onChange={(e) => setF((s) => ({ ...s, frequency: e.target.value as AnnouncementFrequency }))}
            >
              {freqs(t).map((fr) => (
                <option key={fr.value} value={fr.value}>
                  {fr.label}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <span className="text-muted-foreground">Cible :</span>
            {ROLES.map((r) => (
              <label key={r} className="flex items-center gap-1">
                <input
                  type="checkbox"
                  className="accent-primary"
                  checked={f.roles.includes(r)}
                  onChange={() => toggleRole(r)}
                />
                {r}
              </label>
            ))}
            <span className="text-muted-foreground">{t('admin.announce.allRoles')}</span>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <label className="flex flex-col gap-1 text-muted-foreground">
              {t('common.start')}
              <Input
                type="datetime-local"
                value={f.startsAt}
                onChange={(e) => setF((s) => ({ ...s, startsAt: e.target.value }))}
              />
            </label>
            <label className="flex flex-col gap-1 text-muted-foreground">
              {t('common.end')}
              <Input
                type="datetime-local"
                value={f.endsAt}
                onChange={(e) => setF((s) => ({ ...s, endsAt: e.target.value }))}
              />
            </label>
            <label className="flex items-center gap-1.5 self-end pb-2">
              <input
                type="checkbox"
                className="accent-primary"
                checked={f.active}
                onChange={(e) => setF((s) => ({ ...s, active: e.target.checked }))}
              />
              {t('common.active')}
            </label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>
            {t('common.undo')}
          </Button>
          <Button size="sm" onClick={save} disabled={busy}>
            {busy ? 'Enregistrement…' : t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
