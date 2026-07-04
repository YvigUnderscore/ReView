import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { SkeletonRows } from '../../components/ui/skeleton';
import { SETTINGS_FIELDS } from './adminShared';

export default function SettingsTab() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: qk.admin('settings'),
    queryFn: () => api.get<{ settings: Record<string, string> }>('/api/studio/settings').then((d) => d.settings),
  });
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const settings = { ...(data ?? {}), ...edits };

  const save = async (key: string) => {
    try {
      await api.put('/api/studio/settings', { key, value: settings[key] ?? '' });
      qc.invalidateQueries({ queryKey: qk.admin('settings') });
      setSavedKey(key); setTimeout(() => setSavedKey(null), 1500);
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Enregistrement impossible'); }
  };

  if (isLoading) return <SkeletonRows count={5} />;
  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      {SETTINGS_FIELDS.map((f) => (
        <div key={f.key} className="flex flex-wrap items-center gap-2 text-sm">
          <label className="w-64 text-muted-foreground">{f.label}</label>
          <Input className="flex-1 py-1 text-xs" placeholder={f.hint} value={settings[f.key] ?? ''} onChange={(e) => setEdits((s) => ({ ...s, [f.key]: e.target.value }))} />
          <Button variant="outline" size="sm" onClick={() => save(f.key)}>
            {savedKey === f.key ? '✓ Enregistré' : 'Enregistrer'}
          </Button>
        </div>
      ))}
    </div>
  );
}
