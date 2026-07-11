import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../stores/useAuth';
import { t, useT } from '../lib/i18n';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { AuthLayout } from './auth/AuthLayout';

/** Traduit les erreurs techniques en messages humains. */
function humanError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('invalid') || m.includes('incorrect') || m.includes('identifiant'))
    return t('login.error.credentials');
  if (m.includes('network') || m.includes('fetch') || m.includes('failed')) return t('login.error.network');
  return message;
}

export default function LoginPage() {
  const tr = useT();
  const login = useAuth((s) => s.login);
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(email, password);
      navigate('/');
    } catch (err) {
      setError(humanError(err instanceof Error ? err.message : tr('login.error.generic')));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout title={tr('login.title')} subtitle={tr('login.subtitle')}>
      <div className="mb-6">
        <h2 className="text-xl font-semibold">{tr('login.heading')}</h2>
        <p className="text-sm text-muted-foreground">{tr('login.lead')}</p>
      </div>
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="email">{tr('login.email')}</Label>
          <Input
            id="email"
            type="email"
            placeholder="vous@studio.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">{tr('login.password')}</Label>
          <Input
            id="password"
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? tr('login.submitting') : tr('login.submit')}
        </Button>
      </form>
    </AuthLayout>
  );
}
