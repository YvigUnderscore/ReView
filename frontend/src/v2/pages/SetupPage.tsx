// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { api } from '../../lib/apiClient';
import { useAuth, type AuthUser } from '../stores/useAuth';
import { useT, type MessageKey } from '../i18n';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { AuthLayout } from './auth/AuthLayout';

const STEP_KEYS: MessageKey[] = ['setup.step.studio', 'setup.step.admin'];

export default function SetupPage() {
  const tr = useT();
  const setAuth = useAuth((s) => s.setAuth);
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({ studioName: '', adminName: '', adminEmail: '', adminPassword: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const next = () => {
    if (!form.studioName.trim()) return setError(tr('setup.studioName.required'));
    setError(null);
    setStep(1);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { token, user } = await api.post<{ token: string; user: AuthUser }>('/api/setup', form);
      setAuth(token, user);
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : tr('setup.error.generic'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout title={tr('setup.title')} subtitle={tr('setup.subtitle')}>
      {/* Progression */}
      <ol className="mb-6 flex items-center gap-2 text-xs">
        {STEP_KEYS.map((key, i) => (
          <li key={key} className="flex items-center gap-2">
            <span
              className={`flex h-6 w-6 items-center justify-center rounded-full border text-[11px] font-medium ${
                i <= step
                  ? 'border-primary bg-primary/15 text-primary'
                  : 'border-border text-muted-foreground'
              }`}
            >
              {i + 1}
            </span>
            <span className={i === step ? 'font-medium text-foreground' : 'text-muted-foreground'}>
              {tr(key)}
            </span>
            {i < STEP_KEYS.length - 1 && <span className="mx-1 h-px w-6 bg-border" />}
          </li>
        ))}
      </ol>

      {step === 0 ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            next();
          }}
          className="space-y-4"
        >
          <div className="space-y-1.5">
            <Label htmlFor="studioName">{tr('setup.studioName')}</Label>
            <Input
              id="studioName"
              placeholder={tr('setup.studioName.placeholder')}
              value={form.studioName}
              onChange={set('studioName')}
              autoFocus
              required
            />
            <p className="text-xs text-muted-foreground">{tr('setup.studioName.hint')}</p>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full">
            {tr('setup.continue')}
          </Button>
        </form>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="adminName">{tr('setup.adminName')}</Label>
            <Input
              id="adminName"
              placeholder={tr('setup.adminName.placeholder')}
              value={form.adminName}
              onChange={set('adminName')}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="adminEmail">{tr('setup.adminEmail')}</Label>
            <Input
              id="adminEmail"
              type="email"
              placeholder="admin@studio.com"
              value={form.adminEmail}
              onChange={set('adminEmail')}
              autoComplete="email"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="adminPassword">{tr('setup.password')}</Label>
            <Input
              id="adminPassword"
              type="password"
              placeholder={tr('setup.password.placeholder')}
              value={form.adminPassword}
              onChange={set('adminPassword')}
              autoComplete="new-password"
              required
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setError(null);
                setStep(0);
              }}
              className="shrink-0"
            >
              <ArrowLeft size={16} />
            </Button>
            <Button type="submit" disabled={busy} className="w-full">
              {busy ? tr('setup.submitting') : tr('setup.submit')}
            </Button>
          </div>
        </form>
      )}
    </AuthLayout>
  );
}
