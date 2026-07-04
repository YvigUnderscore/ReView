import { useRef, useState, type DragEvent } from 'react';
import { UploadCloud } from 'lucide-react';

/**
 * Drop-zone d'upload visible en permanence (10.C3) : glisser-déposer ou clic.
 * Les fichiers sont remis au parent, qui choisit la version cible.
 */
export default function TaskDropzone({
  latestVersionName,
  onFiles,
}: {
  latestVersionName: string | null;
  onFiles: (files: File[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const emit = (list: FileList | null | undefined) => {
    const files = list ? Array.from(list) : [];
    if (files.length) onFiles(files);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    emit(e.dataTransfer.files);
  };

  return (
    <button
      type="button"
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={`flex w-full items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-4 text-sm transition-colors ${
        over
          ? 'border-primary bg-primary/5 text-foreground'
          : 'border-border text-muted-foreground hover:border-primary/60 hover:text-foreground'
      }`}
    >
      <UploadCloud size={18} className="shrink-0" />
      <span>
        Glissez un fichier ici ou cliquez pour l’ajouter{' '}
        {latestVersionName ? (
          <>
            à la version <strong className="text-foreground">{latestVersionName}</strong>
          </>
        ) : (
          'en créant une première version'
        )}
      </span>
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          emit(e.target.files);
          if (inputRef.current) inputRef.current.value = '';
        }}
      />
    </button>
  );
}
