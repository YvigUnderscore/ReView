import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { api } from '../../lib/apiClient';
import { useAuth, type AuthUser } from '../stores/useAuth';
import Shell from '../components/Shell';
import Avatar from '../components/Avatar';
import DisplaySettings from '../components/DisplaySettings';
import PushToggle from './profile/PushToggle';
import { DigestToggle, WeeklyReportToggle } from './profile/EmailToggles';
import SessionsSection from './profile/SessionsSection';
import ApiTokensSection from './profile/ApiTokensSection';
import TwoFaSection from './profile/TwoFaSection';
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
    jobTitle: user?.jobTitle ?? '',
    bio: user?.bio ?? '',
    phone: user?.phone ?? '',
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
      if (vals.jobTitle !== (user.jobTitle ?? '')) body.jobTitle = vals.jobTitle;
      if (vals.bio !== (user.bio ?? '')) body.bio = vals.bio;
      if (vals.phone !== (user.phone ?? '')) body.phone = vals.phone;
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
            <Field
              label="Fonction"
              value={vals.jobTitle}
              onChange={(v) => setVals((s) => ({ ...s, jobTitle: v }))}
              placeholder="ex. Compositing artist"
            />
            <Field
              label="Téléphone"
              value={vals.phone}
              onChange={(v) => setVals((s) => ({ ...s, phone: v }))}
              placeholder="optionnel"
            />
          </div>
          <div>
            <Label className="mb-1 block text-xs text-muted-foreground">Présentation</Label>
            <textarea
              value={vals.bio}
              onChange={(e) => setVals((s) => ({ ...s, bio: e.target.value }))}
              maxLength={500}
              rows={3}
              placeholder="Quelques mots sur vous (optionnel)"
              className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
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

        <DisplaySettings />

        <section className="space-y-3 rounded-lg border border-border bg-card p-4">
          <h2 className="text-sm font-semibold">Notifications</h2>
          <DigestToggle />
          <WeeklyReportToggle />
          <PushToggle />
        </section>

        {/* Sécurité du compte (36.A/36.B/36.C) : 2FA + sessions actives + tokens d'API. */}
        <TwoFaSection />
        <SessionsSection />
        <ApiTokensSection />
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
