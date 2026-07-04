import { useUploadStore } from '../../stores/useUploadStore';

/** Widget d'upload non-bloquant (bas-droite). Lit le store Zustand global. */
export default function UploadWidget() {
  const uploads = useUploadStore((s) => s.uploads);
  const clear = useUploadStore((s) => s.clearCompleted);
  if (uploads.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 w-80 rounded-lg border border-border bg-card shadow-lg">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-sm font-medium">Transferts ({uploads.length})</span>
        <button onClick={clear} className="text-xs text-muted-foreground hover:text-foreground">
          Nettoyer
        </button>
      </div>
      <ul className="max-h-64 overflow-auto p-2 space-y-2">
        {uploads.map((u) => (
          <li key={u.id} className="text-xs">
            <div className="flex justify-between">
              <span className="truncate">{u.filename}</span>
              <span className="text-muted-foreground">{u.status}</span>
            </div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-muted">
              <div
                className={`h-full ${u.status === 'error' ? 'bg-destructive' : 'bg-primary'}`}
                style={{ width: `${u.progress}%` }}
              />
            </div>
            {u.error && <p className="mt-1 text-destructive">{u.error}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}
