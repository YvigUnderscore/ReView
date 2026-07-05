import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { api } from '../../lib/apiClient';
import { useAuth, type AuthUser } from '../stores/useAuth';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { AuthLayout } from './auth/AuthLayout';

const STEPS = ['Studio', 'Compte admin'] as const;

export default function SetupPage() {
  const setAuth = useAuth((s) => s.setAuth);
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({ studioName: '', adminName: '', adminEmail: '', adminPassword: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const next = () => {
    if (!form.studioName.trim()) return setError('Indiquez le nom de votre studio.');
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
      setError(err instanceof Error ? err.message : 'Échec de configuration');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      title="Bienvenue sur ReView."
      subtitle="Configurons votre studio en deux étapes. Vous pourrez tout ajuster ensuite."
    >
      {/* Progression */}
      <ol className="mb-6 flex items-center gap-2 text-xs">
        {STEPS.map((label, i) => (
          <li key={label} className="flex items-center gap-2">
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
              {label}
            </span>
            {i < STEPS.length - 1 && <span className="mx-1 h-px w-6 bg-border" />}
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
            <Label htmlFor="studioName">Nom du studio</Label>
            <Input
              id="studioName"
              placeholder="Mon Studio"
              value={form.studioName}
              onChange={set('studioName')}
              autoFocus
              required
            />
            <p className="text-xs text-muted-foreground">Le nom affiché à votre équipe.</p>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full">
            Continuer
          </Button>
        </form>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="adminName">Votre nom</Label>
            <Input
              id="adminName"
              placeholder="Jean Dupont"
              value={form.adminName}
              onChange={set('adminName')}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="adminEmail">Email admin</Label>
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
            <Label htmlFor="adminPassword">Mot de passe</Label>
            <Input
              id="adminPassword"
              type="password"
              placeholder="8+ car., 1 lettre, 1 chiffre"
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
              {busy ? 'Création…' : 'Créer le studio'}
            </Button>
          </div>
        </form>
      )}
    </AuthLayout>
  );
}
