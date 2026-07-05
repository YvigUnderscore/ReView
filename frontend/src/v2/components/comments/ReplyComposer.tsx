import { useRef, useState } from 'react';
import { ImagePlus, X } from 'lucide-react';
import { api } from '../../../lib/apiClient';
import { uploadCommentImages } from '../../../lib/commentAttachments';

/** Zone de réponse à un commentaire (texte + images jointes). */
export default function ReplyComposer({
  mediaObjectId,
  parentId,
  onSent,
  onCancel,
}: {
  mediaObjectId: number;
  parentId: number;
  onSent: () => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const send = async () => {
    if (!text.trim() && files.length === 0) return;
    setBusy(true);
    try {
      const attachments = files.length > 0 ? await uploadCommentImages(files) : undefined;
      await api.post('/api/comments', { mediaObjectId, parentId, content: text || '(image)', attachments });
      setText('');
      setFiles([]);
      onSent();
    } catch {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2 rounded-md border border-border bg-background p-2">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        placeholder="Votre réponse…"
        className="w-full resize-none bg-transparent text-sm focus:outline-none"
      />
      {files.length > 0 && (
        <div className="mb-1 flex flex-wrap gap-1">
          {files.map((f, i) => (
            <span key={i} className="flex items-center gap-1 rounded bg-secondary px-1.5 py-0.5 text-[10px]">
              {f.name}
              <button onClick={() => setFiles((fs) => fs.filter((_, j) => j !== i))}>
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              setFiles((fs) => [...fs, ...Array.from(e.target.files ?? [])]);
              if (fileRef.current) fileRef.current.value = '';
            }}
          />
          <button
            onClick={() => fileRef.current?.click()}
            title="Joindre une image"
            className="rounded p-1 text-muted-foreground hover:bg-secondary"
          >
            <ImagePlus size={15} />
          </button>
        </div>
        <div className="flex gap-1">
          <button
            onClick={onCancel}
            className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-secondary"
          >
            Annuler
          </button>
          <button
            onClick={send}
            disabled={busy}
            className="rounded bg-primary px-2.5 py-1 text-xs text-primary-foreground disabled:opacity-50"
          >
            Répondre
          </button>
        </div>
      </div>
    </div>
  );
}
