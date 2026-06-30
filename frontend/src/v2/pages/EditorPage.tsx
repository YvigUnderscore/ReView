import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../lib/apiClient';
import { useUploadStore } from '../../stores/useUploadStore';
import Shell from '../components/Shell';

/**
 * Édition Gaussian Splat (9.A3) — éditeur SuperSplat vendoré.
 *
 * Workflow : ouvrir le splat draft dans l'éditeur (iframe `public/supersplat-editor/`),
 * éditer, exporter le fichier, puis le ré-importer ci-dessous → nouveau média draft sur
 * la même version → publication.
 *
 * NB : l'éditeur SuperSplat (build de https://github.com/playcanvas/supersplat) doit être
 * déposé dans `frontend/public/supersplat-editor/` (comme le viewer). En son absence,
 * l'iframe affiche un 404 et on garde le ré-import manuel.
 */
interface MediaResp { media: { id: number; kind: string; originalName: string; versionId: number }; url: string }

export default function EditorPage() {
  const { mediaId } = useParams();
  const id = Number(mediaId);
  const enqueue = useUploadStore((s) => s.enqueue);
  const uploads = useUploadStore((s) => s.uploads);
  const [data, setData] = useState<MediaResp | null>(null);
  const [editorAvailable, setEditorAvailable] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploadId, setUploadId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.get<MediaResp>(`/api/media/${id}`).then(setData).catch((e) => setError(e.message));
    // Détection fiable : nginx renvoie l'app (fallback SPA) pour tout chemin manquant.
    // On considère l'éditeur présent seulement si l'index n'est PAS l'app ReView (pas de <div id="root">).
    fetch('/supersplat-editor/index.html')
      .then((r) => (r.ok ? r.text() : Promise.reject()))
      .then((html) => setEditorAvailable(!html.includes('id="root"')))
      .catch(() => setEditorAvailable(false));
  }, [id]);

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && data) setUploadId(enqueue(file, data.media.versionId, 'SPLAT'));
    if (fileRef.current) fileRef.current.value = '';
  };

  const done = uploadId != null && uploads.some((u) => u.id === uploadId && u.status === 'done');

  return (
    <Shell title="Édition Gaussian Splat">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">{data?.media.originalName ?? 'Splat'}</h2>
        <Link to={`/review/${id}`} className="text-sm text-muted-foreground hover:text-foreground">← Review</Link>
      </div>
      {error && <p className="mb-2 text-sm text-destructive">{error}</p>}

      <div className="mb-3 rounded-lg border border-border bg-card">
        {editorAvailable === false && (
          <div className="p-4 text-sm text-muted-foreground">
            Éditeur SuperSplat non vendoré. Déposez son build dans <code>frontend/public/supersplat-editor/</code>.
            En attendant : éditez avec un outil externe puis ré-importez le fichier ci-dessous.
          </div>
        )}
        {editorAvailable && data?.url && (
          <iframe
            title="SuperSplat Editor"
            // Double-encodage volontaire : l'éditeur SuperSplat lit ces params via
            // `searchParams.getAll(...)` (qui décode déjà une fois) puis refait un
            // `decodeURIComponent(...)`. Sans ce double-encodage, les `%2F` de l'URL
            // présignée MinIO (X-Amz-Credential = `minioadmin%2F…%2Fs3%2Faws4_request`)
            // redeviennent des `/`, la détection de type coupe au dernier `/` du credential
            // et l'extension `.ply` est perdue → « Unsupported input file type ».
            src={`/supersplat-editor/index.html?load=${encodeURIComponent(encodeURIComponent(data.url))}&filename=${encodeURIComponent(encodeURIComponent(data.media.originalName))}`}
            className="h-[70vh] w-full rounded-lg border-0"
            allow="xr-spatial-tracking; fullscreen; cross-origin-isolated"
          />
        )}
        {editorAvailable === null && <div className="p-4 text-sm text-muted-foreground">Détection de l'éditeur…</div>}
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-2 text-sm font-medium">Ré-importer le splat édité</h3>
        <p className="mb-2 text-xs text-muted-foreground">
          Crée un nouveau média <strong>brouillon</strong> sur cette version. Vérifiez-le en review puis publiez-le.
        </p>
        <input ref={fileRef} type="file" accept=".ply,.splat,.sog" onChange={onFile}
          className="block text-sm text-muted-foreground file:mr-3 file:rounded-md file:border file:border-border file:bg-muted file:px-3 file:py-1 file:text-sm" />
        {done && <p className="mt-2 text-sm text-green-400">✓ Importé — disponible en brouillon sur la version.</p>}
      </div>
    </Shell>
  );
}
