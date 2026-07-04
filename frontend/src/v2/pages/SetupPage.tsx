import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/apiClient';
import { useAuth, type AuthUser } from '../stores/useAuth';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Label } from '../components/ui/label';

export default function SetupPage() {
  const setAuth = useAuth((s) => s.setAuth);
  const navigate = useNavigate();
  const [form, setForm] = useState({ studioName: '', adminName: '', adminEmail: '', adminPassword: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

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
    <div className="min-h-screen flex items-center justify-center bg-background text-foreground">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl">Bienvenue sur ReView</CardTitle>
          <CardDescription>Configuration initiale du studio</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="studioName">Nom du studio</Label>
              <Input
                id="studioName"
                placeholder="Mon Studio"
                value={form.studioName}
                onChange={set('studioName')}
                required
              />
            </div>
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
                required
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" disabled={busy} className="w-full">
              {busy ? 'Création…' : 'Créer le studio'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
