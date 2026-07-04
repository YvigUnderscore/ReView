import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { api } from '../../lib/apiClient';
import { useAuth, type AuthUser } from '../stores/useAuth';
import Shell from '../components/Shell';
import Avatar from '../components/Avatar';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';

export default function ProfilePage() {
  const user = useAuth((s) => s.user);
  const setUser = useAuth((s) => s.setUser);
  const fileRef = useRef<HTMLInputElement>(null);
  const [vals, setVals] = useState({
    firstName: user?.firstName ?? '',
    lastName: user?.lastName ?? '',
    username: user?.username ?? '',
    email: user?.email ?? '',
  });
  const [pwd, setPwd] = useState('');
  const [busy, setBusy] = useState(false);

  if (!user) return null;

  const saveProfile = async () => {
    setBusy(true);
    try {
      const body: Record<string, string> = {};
      if (vals.firstName !== (user.firstName ?? '')) body.firstName = vals.firstName;
      if (vals.lastName !== (user.lastName ?? '')) body.lastName = vals.lastName;
      if (vals.username !== (user.username ?? '')) body.username = vals.username;
      if (vals.email !== user.email) body.email = vals.email;
      const { user: updated } = await api.patch<{ user: AuthUser }>('/api/users/me', body);
      setUser(updated);
      toast.success('Profil mis à jour');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erreur');
    } finally {
      setBusy(false);
    }
  };

  const savePassword = async () => {
    if (pwd.length < 8) {
      toast.error('8 caractères minimum (lettres + chiffres).');
      return;
    }
    setBusy(true);
    try {
      const { user: updated } = await api.patch<{ user: AuthUser }>('/api/users/me', { password: pwd });
      setUser(updated);
      setPwd('');
      toast.success('Mot de passe modifié');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erreur');
    } finally {
      setBusy(false);
    }
  };

  const onAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = '';
    if (!file) return;
    if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) {
      toast.error('Format image invalide (png/jpg/webp).');
      return;
    }
    setBusy(true);
    try {
      const { url, key } = await api.post<{ url: string; key: string }>('/api/users/me/avatar/presign', {
        contentType: file.type,
      });
      const put = await fetch(url, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
      if (!put.ok) throw new Error('Échec de l’upload');
      const { user: updated } = await api.put<{ user: AuthUser }>('/api/users/me/avatar', { key });
      setUser(updated);
      toast.success('Avatar mis à jour');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setBusy(false);
    }
  };

  const removeAvatar = async () => {
    setBusy(true);
    try {
      const { user: updated } = await api.put<{ user: AuthUser }>('/api/users/me/avatar', { key: null });
      setUser(updated);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell>
      <div className="mx-auto max-w-2xl space-y-6">
        <h1 className="text-xl font-semibold">Mon profil</h1>

        <section className="flex items-center gap-4 rounded-lg border border-border bg-card p-4">
          <Avatar
            seed={user.id}
            initials={user.initials ?? user.email.slice(0, 2).toUpperCase()}
            avatarUrl={user.avatarUrl}
            size={64}
          />
          <div className="space-y-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={onAvatar}
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={() => fileRef.current?.click()} disabled={busy}>
                Changer l’avatar
              </Button>
              {user.avatarUrl && (
                <Button size="sm" variant="outline" onClick={removeAvatar} disabled={busy}>
                  Retirer
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">PNG, JPG ou WebP.</p>
          </div>
        </section>

        <section className="space-y-3 rounded-lg border border-border bg-card p-4">
          <h2 className="text-sm font-semibold">Identité</h2>
          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Prénom"
              value={vals.firstName}
              onChange={(v) => setVals((s) => ({ ...s, firstName: v }))}
            />
            <Field
              label="Nom"
              value={vals.lastName}
              onChange={(v) => setVals((s) => ({ ...s, lastName: v }))}
            />
            <Field
              label="Pseudo"
              value={vals.username}
              onChange={(v) => setVals((s) => ({ ...s, username: v }))}
              placeholder="affiché en priorité"
            />
            <Field
              label="Email"
              value={vals.email}
              onChange={(v) => setVals((s) => ({ ...s, email: v }))}
              type="email"
            />
          </div>
          <Button onClick={saveProfile} disabled={busy}>
            Enregistrer
          </Button>
        </section>

        <section className="space-y-3 rounded-lg border border-border bg-card p-4">
          <h2 className="text-sm font-semibold">Mot de passe</h2>
          <Field
            label="Nouveau mot de passe"
            value={pwd}
            onChange={setPwd}
            type="password"
            placeholder="8 caractères min., lettres + chiffres"
          />
          <Button onClick={savePassword} disabled={busy || !pwd}>
            Changer le mot de passe
          </Button>
        </section>
      </div>
    </Shell>
  );
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
