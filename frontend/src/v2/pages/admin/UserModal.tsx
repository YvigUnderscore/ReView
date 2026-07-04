import { useState } from 'react';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Select } from '../../components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { ROLES } from './adminShared';
import type { Role, User } from '../../types/api';

/** Création / édition d'un utilisateur (dialog). */
export default function UserModal({
  title,
  user,
  onClose,
  onSaved,
}: {
  title: string;
  user?: User;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!user;
  const [form, setForm] = useState({
    email: user?.email ?? '',
    password: '',
    firstName: user?.firstName ?? '',
    lastName: user?.lastName ?? '',
    username: user?.username ?? '',
    role: (user?.role ?? 'ARTIST') as Role,
    storageLimitGo: user?.storageLimit ? String((user.storageLimit / 1e9).toFixed(0)) : '',
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        email: form.email,
        firstName: form.firstName || null,
        lastName: form.lastName || null,
        username: form.username || null,
        role: form.role,
      };
      if (form.password) body.password = form.password;
      if (form.storageLimitGo) body.storageLimit = Math.round(Number(form.storageLimitGo) * 1e9);
      if (isEdit) {
        await api.patch(`/api/users/${user!.id}`, body);
        toast.success('Utilisateur modifié');
      } else {
        if (!form.password) throw new Error('Mot de passe requis');
        await api.post('/api/users', body);
        toast.success('Utilisateur créé');
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent>
        <form onSubmit={submit} className="space-y-3">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-2">
            <Input
              placeholder="Prénom"
              value={form.firstName}
              onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
            />
            <Input
              placeholder="Nom"
              value={form.lastName}
              onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
            />
          </div>
          <Input
            placeholder="Pseudo (affiché)"
            value={form.username}
            onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
          />
          <Input
            type="email"
            placeholder="Email"
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            required
          />
          <Input
            type="password"
            placeholder={
              isEdit ? 'Nouveau mot de passe (laisser vide)' : 'Mot de passe (8+ car., lettres + chiffres)'
            }
            value={form.password}
            onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
            required={!isEdit}
          />
          <div className="grid grid-cols-2 gap-2">
            <Select
              className="w-full"
              value={form.role}
              onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as Role }))}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Select>
            <Input
              type="number"
              placeholder="Quota (Go)"
              value={form.storageLimitGo}
              onChange={(e) => setForm((f) => ({ ...f, storageLimitGo: e.target.value }))}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              Annuler
            </Button>
            <Button type="submit" size="sm" disabled={busy}>
              {isEdit ? 'Enregistrer' : 'Créer'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
