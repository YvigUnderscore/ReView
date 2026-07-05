import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../stores/useAuth';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { AuthLayout } from './auth/AuthLayout';

/** Traduit les erreurs techniques en messages humains. */
function humanError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('invalid') || m.includes('incorrect') || m.includes('identifiant'))
    return 'Email ou mot de passe incorrect.';
  if (m.includes('network') || m.includes('fetch') || m.includes('failed'))
    return 'Connexion au serveur impossible. Réessayez dans un instant.';
  return message;
}

export default function LoginPage() {
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
      setError(humanError(err instanceof Error ? err.message : 'Échec de connexion'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout title="Bon retour." subtitle="Connectez-vous pour retrouver vos reviews, tâches et boards.">
      <div className="mb-6">
        <h2 className="text-xl font-semibold">Connexion</h2>
        <p className="text-sm text-muted-foreground">Accédez à votre espace studio.</p>
      </div>
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
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
          <Label htmlFor="password">Mot de passe</Label>
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
          {busy ? 'Connexion…' : 'Se connecter'}
        </Button>
      </form>
    </AuthLayout>
  );
}
