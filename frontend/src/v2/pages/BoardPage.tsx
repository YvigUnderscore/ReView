import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Excalidraw, convertToExcalidrawElements } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import { api } from '../../lib/apiClient';
import Shell from '../components/Shell';
import EntityBreadcrumb from '../components/EntityBreadcrumb';
import { useTheme } from '../stores/useTheme';

/**
 * Board mood/reference (Excalidraw, MIT) — un board par Projet et un par Asset (9.B).
 * Persistance API (sauvegarde debouncée + reload). Drag-drop d'images natif + insertion
 * depuis la bibliothèque média (médias publiés du projet).
 */
type Scope = 'project' | 'asset';
interface MediaLite { id: number; originalName: string; kind: string; thumbnailUrl: string | null; url: string }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ExcalidrawApi = any;

const uid = () => Math.random().toString(36).slice(2, 10);
const blobToDataURL = (b: Blob) => new Promise<string>((res, rej) => {
  const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = rej; r.readAsDataURL(b);
});

export default function BoardPage({ scope }: { scope: Scope }) {
  const { id } = useParams();
  const theme = useTheme((s) => s.theme);
  const targetId = Number(id);
  const base = `/api/boards/${scope}/${targetId}`;
  const [initial, setInitial] = useState<{ elements: unknown[]; files: unknown } | null>(null);
  const [saved, setSaved] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showLib, setShowLib] = useState(false);
  const [library, setLibrary] = useState<MediaLite[]>([]);
  const apiRef = useRef<ExcalidrawApi>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    api.get<{ board: { document: { elements?: unknown[]; files?: unknown } } }>(base)
      .then((d) => setInitial({ elements: d.board.document?.elements ?? [], files: d.board.document?.files ?? {} }))
      .catch((e) => { setError(e.message); setInitial({ elements: [], files: {} }); });
  }, [base]);

  const save = (elements: readonly unknown[], _appState: unknown, files: unknown) => {
    setSaved(false);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try { await api.put(base, { document: { elements, files } }); setSaved(true); }
      catch (e) { setError(e instanceof Error ? e.message : 'Erreur'); }
    }, 1200);
  };

  const openLibrary = async () => {
    setShowLib((s) => !s);
    if (library.length) return;
    try {
      const projectId = scope === 'project'
        ? targetId
        : (await api.get<{ asset: { projectId: number } }>(`/api/assets/${targetId}`)).asset.projectId;
      const { media } = await api.get<{ media: MediaLite[] }>(`/api/media?projectId=${projectId}&kind=IMAGE`);
      setLibrary(media);
    } catch (e) { setError(e instanceof Error ? e.message : 'Erreur'); }
  };

  const insert = async (m: MediaLite) => {
    const ex = apiRef.current;
    if (!ex) return;
    try {
      const blob = await (await fetch(m.url)).blob();
      const dataURL = await blobToDataURL(blob);
      const fileId = uid();
      ex.addFiles([{ id: fileId, mimeType: blob.type || 'image/jpeg', dataURL, created: Date.now() }]);
      const els = convertToExcalidrawElements([
        { type: 'image', fileId, x: 80, y: 80, width: 320, height: 220 } as never,
      ]);
      ex.updateScene({ elements: [...ex.getSceneElements(), ...els] });
    } catch (e) { setError(e instanceof Error ? e.message : 'Insertion échouée'); }
  };

  if (!initial) return <Shell title="Board"><p className="text-sm text-muted-foreground">Chargement du board…</p></Shell>;

  return (
    <Shell
      title={`Board ${scope === 'project' ? 'projet' : 'asset'} — mood/reference`}
      breadcrumb={<EntityBreadcrumb entity={scope === 'project' ? 'project' : 'asset'} id={targetId} tail="Board" />}
    >
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={openLibrary} className="rounded-md border border-border px-3 py-1 text-sm hover:bg-muted">Bibliothèque média</button>
          <span className="text-xs text-muted-foreground">{saved ? '✓ enregistré' : '… enregistrement'}</span>
        </div>
        <Link to={scope === 'project' ? `/projects/${targetId}` : `/assets/${targetId}`} className="text-sm text-muted-foreground hover:text-foreground">← Retour</Link>
      </div>
      {error && <p className="mb-2 text-sm text-destructive">{error}</p>}
      <div className="flex gap-3">
        {showLib && (
          <div className="custom-scrollbar w-44 shrink-0 space-y-2 overflow-auto rounded-lg border border-border bg-card p-2" style={{ height: '78vh' }}>
            <div className="text-xs font-medium text-muted-foreground">Images publiées</div>
            {library.map((m) => (
              <button key={m.id} onClick={() => insert(m)} title={`Insérer ${m.originalName}`}
                className="block w-full overflow-hidden rounded border border-border hover:border-primary">
                {m.thumbnailUrl
                  ? <img src={m.thumbnailUrl} alt={m.originalName} className="h-20 w-full object-cover" />
                  : <div className="flex h-20 items-center justify-center text-[10px] text-muted-foreground">{m.originalName}</div>}
              </button>
            ))}
            {library.length === 0 && <p className="text-[11px] text-muted-foreground">Aucune image publiée. Glissez-déposez directement vos fichiers sur le board.</p>}
          </div>
        )}
        <div style={{ height: '78vh' }} className="flex-1 overflow-hidden rounded-lg border border-border">
          <Excalidraw
            excalidrawAPI={(a: ExcalidrawApi) => { apiRef.current = a; }}
            initialData={{ elements: initial.elements as never, files: initial.files as never }}
            onChange={save}
            theme={theme}
          />
        </div>
      </div>
    </Shell>
  );
}
