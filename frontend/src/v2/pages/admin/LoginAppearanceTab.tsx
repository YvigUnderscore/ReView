// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Save, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Select } from '../../components/ui/select';
import { SkeletonRows } from '../../components/ui/skeleton';
import { Panel } from './AdminPrimitives';
import { useT } from '../../i18n';
import type { LoginAppearance } from '../../lib/branding';
import { backdropStyle, overlayStyle } from '../auth/loginStyles';

/**
 * Section « Page de connexion » : habillage de l'écran vu avant toute authentification —
 * image de fond, voile, flou, disposition, accroche, logo. L'aperçu utilise les mêmes
 * fonctions de style que la vraie page, pour qu'il n'y ait rien à découvrir après
 * l'enregistrement.
 */
export default function LoginAppearanceTab() {
  const t = useT();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<LoginAppearance | null>(null);
  const [busy, setBusy] = useState(false);

  const { data } = useQuery({
    queryKey: qk.admin('login-appearance'),
    queryFn: () => api.get<{ login: LoginAppearance }>('/api/studio/login-appearance').then((d) => d.login),
  });
  if (data && !draft) setDraft(data);
  if (!draft) return <SkeletonRows count={5} />;

  const set = (patch: Partial<LoginAppearance>) => setDraft((d) => d && { ...d, ...patch });

  // Le branding est partagé avec la page de connexion : l'invalider fait suivre l'app.
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: qk.admin('login-appearance') });
    void qc.invalidateQueries({ queryKey: qk.branding });
  };

  const put = async (patch: Partial<LoginAppearance>) => {
    const { login } = await api.put<{ login: LoginAppearance }>('/api/studio/login-appearance', patch);
    setDraft(login);
    invalidate();
    return login;
  };

  const save = async () => {
    setBusy(true);
    try {
      const { bgUrl: _ignored, ...patch } = draft;
      await put(patch);
      toast.success(t('login.appearance.saved'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error.generic'));
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = '';
    if (!file) return;
    if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) {
      toast.error(t('profile.avatar.invalidFormat'));
      return;
    }
    setBusy(true);
    try {
      const { url, key } = await api.post<{ url: string; key: string }>(
        '/api/studio/login-appearance/bg/presign',
        { contentType: file.type },
      );
      const upload = await fetch(url, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
      if (!upload.ok) throw new Error(t('profile.avatar.uploadFailed'));
      // L'image est enregistrée tout de suite : téléverser sans poser la clé laisserait un
      // objet orphelin dans le stockage et rien à l'écran.
      await put({ bgKey: key });
      toast.success(t('login.appearance.imageUpdated'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error.generic'));
    } finally {
      setBusy(false);
    }
  };

  const removeImage = async () => {
    setBusy(true);
    try {
      await put({ bgKey: null });
      toast.success(t('login.appearance.imageRemoved'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error.generic'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-3xl space-y-4">
      <Panel title={t('login.appearance.background')}>
        <p className="mb-3 text-xs text-muted-foreground">{t('login.appearance.hint')}</p>
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex h-20 w-36 items-center justify-center overflow-hidden rounded-md border border-border bg-background">
            {draft.bgUrl ? (
              <img
                src={draft.bgUrl}
                alt={t('login.appearance.background')}
                className="h-full w-full object-cover"
              />
            ) : (
              <span className="text-xs text-muted-foreground">{t('login.appearance.noImage')}</span>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={onFile}
          />
          <Button size="sm" variant="outline" disabled={busy} onClick={() => fileRef.current?.click()}>
            <Upload size={14} className="mr-1" /> {t('common.upload')}
          </Button>
          {draft.bgUrl && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={removeImage}>
              <Trash2 size={14} className="mr-1 text-destructive" /> {t('common.remove')}
            </Button>
          )}
        </div>
      </Panel>

      <Panel title={t('login.appearance.title')}>
        <div className="space-y-3">
          <Row label={t('login.appearance.layout')}>
            <Select
              className="py-1 text-xs"
              value={draft.layout}
              onChange={(e) => set({ layout: e.target.value as LoginAppearance['layout'] })}
            >
              <option value="split">{t('login.appearance.layout.split')}</option>
              <option value="centered">{t('login.appearance.layout.centered')}</option>
            </Select>
          </Row>
          <Row label={t('login.appearance.fit')}>
            <Select
              className="py-1 text-xs"
              value={draft.bgFit}
              onChange={(e) => set({ bgFit: e.target.value as LoginAppearance['bgFit'] })}
            >
              <option value="cover">{t('login.appearance.fit.cover')}</option>
              <option value="contain">{t('login.appearance.fit.contain')}</option>
            </Select>
          </Row>
          <Row label={t('login.appearance.overlay')}>
            <input
              type="range"
              min={0}
              max={95}
              value={Math.round(draft.overlay * 100)}
              onChange={(e) => set({ overlay: Number(e.target.value) / 100 })}
              className="accent-primary"
            />
            <span className="w-12 text-xs text-muted-foreground">{Math.round(draft.overlay * 100)} %</span>
          </Row>
          <Row label={t('login.appearance.blur')}>
            <input
              type="range"
              min={0}
              max={24}
              value={draft.blur}
              onChange={(e) => set({ blur: Number(e.target.value) })}
              className="accent-primary"
            />
            <span className="w-12 text-xs text-muted-foreground">{draft.blur} px</span>
          </Row>
          <Row label={t('login.appearance.tagline')}>
            <Input
              className="flex-1 py-1 text-xs"
              value={draft.tagline}
              placeholder={t('auth.tagline')}
              onChange={(e) => set({ tagline: e.target.value })}
            />
          </Row>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="accent-primary"
              checked={draft.showLogo}
              onChange={(e) => set({ showLogo: e.target.checked })}
            />
            <span className="font-medium">{t('login.appearance.showLogo')}</span>
          </label>
        </div>
        <div className="mt-3">
          <Button size="sm" onClick={save} disabled={busy}>
            <Save size={14} className="mr-1" /> {t('common.save')}
          </Button>
        </div>
      </Panel>

      <Panel title={t('login.appearance.preview')}>
        <Preview login={draft} />
      </Panel>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <label className="w-56 text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

/** Aperçu miniature : mêmes couches que la vraie page, en réduction. */
function Preview({ login }: { login: LoginAppearance }) {
  const t = useT();
  const bg = backdropStyle(login);
  const veil = overlayStyle(login);
  const tagline = login.tagline || t('auth.tagline');
  const panel = (
    <div className="relative flex flex-col justify-between p-4">
      {login.showLogo && <div className="h-3 w-16 rounded bg-foreground/60" />}
      <div className="space-y-1">
        <div className="h-3 w-24 rounded bg-foreground/40" />
        <p className="line-clamp-2 text-2xs text-muted-foreground">{tagline}</p>
      </div>
    </div>
  );
  const form = (
    <div className="relative flex items-center justify-center p-4">
      <div className="w-32 space-y-2 rounded-md border border-border bg-background/80 p-3">
        <div className="h-2 w-16 rounded bg-foreground/40" />
        <div className="h-4 rounded bg-secondary" />
        <div className="h-4 rounded bg-secondary" />
        <div className="h-4 rounded bg-primary/70" />
      </div>
    </div>
  );
  return (
    <div className="relative h-56 overflow-hidden rounded-lg border border-border bg-background">
      {bg && (
        <>
          <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
            <div
              className="absolute inset-0"
              style={login.layout === 'split' ? { ...bg, right: '50%' } : bg}
            />
          </div>
          {veil && (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0"
              style={login.layout === 'split' ? { ...veil, right: '50%' } : veil}
            />
          )}
        </>
      )}
      {login.layout === 'centered' ? (
        <div className="relative grid h-full place-items-center">{form}</div>
      ) : (
        <div className="relative grid h-full grid-cols-2">
          {panel}
          {form}
        </div>
      )}
    </div>
  );
}
