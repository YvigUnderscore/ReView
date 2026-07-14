import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Select } from '../../components/ui/select';
import { SkeletonRows } from '../../components/ui/skeleton';
import {
  SETTINGS_FIELDS,
  type SettingField,
  type SizeUnit,
  bytesToUnit,
  fmtBytes,
  parseSizeToBytes,
} from './adminShared';

/** Champ taille (Mo/Go) : saisie convertie en octets à l'enregistrement (parse `.` et `,`). */
function SizeField({
  field,
  stored,
  onSave,
}: {
  field: SettingField;
  stored: string;
  onSave: (key: string, value: string) => Promise<void>;
}) {
  const init = bytesToUnit(Number(stored) || 0);
  const [value, setValue] = useState(stored ? init.value : '');
  const [unit, setUnit] = useState<SizeUnit>(init.unit);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    const bytes = parseSizeToBytes(value, unit);
    if (bytes == null) return toast.error('Valeur invalide (nombre attendu)');
    await onSave(field.key, String(bytes));
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <label className="w-64 text-muted-foreground">{field.label}</label>
      <Input
        className="w-24 py-1 text-xs"
        placeholder={field.hint}
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <Select className="py-1 text-xs" value={unit} onChange={(e) => setUnit(e.target.value as SizeUnit)}>
        <option value="Mo">Mo</option>
        <option value="Go">Go</option>
      </Select>
      <span className="w-24 text-xs text-muted-foreground">
        {stored ? `= ${fmtBytes(Number(stored))}` : ''}
      </span>
      <Button variant="outline" size="sm" onClick={save}>
        {saved ? '✓ Enregistré' : 'Enregistrer'}
      </Button>
    </div>
  );
}

/** Champ simple (valeur brute). */
function PlainField({
  field,
  stored,
  onSave,
}: {
  field: SettingField;
  stored: string;
  onSave: (key: string, value: string) => Promise<void>;
}) {
  const [value, setValue] = useState(stored);
  const [saved, setSaved] = useState(false);
  const save = async () => {
    await onSave(field.key, value);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <label className="w-64 text-muted-foreground">{field.label}</label>
      <Input
        className="flex-1 py-1 text-xs"
        placeholder={field.hint}
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <Button variant="outline" size="sm" onClick={save}>
        {saved ? '✓ Enregistré' : 'Enregistrer'}
      </Button>
    </div>
  );
}

export default function SettingsTab() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: qk.admin('settings'),
    queryFn: () =>
      api.get<{ settings: Record<string, string> }>('/api/studio/settings').then((d) => d.settings),
  });

  const persist = async (key: string, value: string) => {
    try {
      await api.put('/api/studio/settings', { key, value });
      qc.invalidateQueries({ queryKey: qk.admin('settings') });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Enregistrement impossible');
    }
  };

  if (isLoading || !data) return <SkeletonRows count={5} />;
  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      {SETTINGS_FIELDS.map((f) =>
        f.bytes ? (
          <SizeField key={f.key} field={f} stored={data[f.key] ?? ''} onSave={persist} />
        ) : (
          <PlainField key={f.key} field={f} stored={data[f.key] ?? ''} onSave={persist} />
        ),
      )}
    </div>
  );
}
