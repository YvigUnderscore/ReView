import { useEffect, useRef } from 'react';
import { Bold, Italic, Underline, Heading2, Heading3, List, ListOrdered, Link as LinkIcon, Quote } from 'lucide-react';

/**
 * Éditeur de texte riche minimal mais complet (WYSIWYG), sans dépendance externe.
 * Basé sur contentEditable + document.execCommand. Émet du HTML (assaini côté serveur).
 */
export default function RichTextEditor({ value, onChange, placeholder }: {
  value: string; onChange: (html: string) => void; placeholder?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // Initialise le contenu sans casser le curseur lors des frappes.
  useEffect(() => {
    if (ref.current && ref.current.innerHTML !== value) {
      ref.current.innerHTML = value;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const exec = (cmd: string, arg?: string) => {
    ref.current?.focus();
    document.execCommand(cmd, false, arg);
    onChange(ref.current?.innerHTML ?? '');
  };
  const addLink = () => {
    const url = window.prompt('URL du lien :');
    if (url) exec('createLink', url);
  };

  const Btn = ({ onClick, title, children }: { onClick: () => void; title: string; children: React.ReactNode }) => (
    <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={onClick} title={title} className="rounded p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground">
      {children}
    </button>
  );

  return (
    <div className="rounded-md border border-border bg-background">
      <div className="flex flex-wrap items-center gap-0.5 border-b border-border p-1">
        <Btn onClick={() => exec('bold')} title="Gras"><Bold size={15} /></Btn>
        <Btn onClick={() => exec('italic')} title="Italique"><Italic size={15} /></Btn>
        <Btn onClick={() => exec('underline')} title="Souligné"><Underline size={15} /></Btn>
        <span className="mx-1 h-5 w-px bg-border" />
        <Btn onClick={() => exec('formatBlock', 'h2')} title="Titre"><Heading2 size={15} /></Btn>
        <Btn onClick={() => exec('formatBlock', 'h3')} title="Sous-titre"><Heading3 size={15} /></Btn>
        <Btn onClick={() => exec('formatBlock', 'blockquote')} title="Citation"><Quote size={15} /></Btn>
        <span className="mx-1 h-5 w-px bg-border" />
        <Btn onClick={() => exec('insertUnorderedList')} title="Liste à puces"><List size={15} /></Btn>
        <Btn onClick={() => exec('insertOrderedList')} title="Liste numérotée"><ListOrdered size={15} /></Btn>
        <Btn onClick={addLink} title="Lien"><LinkIcon size={15} /></Btn>
      </div>
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        data-placeholder={placeholder}
        onInput={() => onChange(ref.current?.innerHTML ?? '')}
        className="prose-doc min-h-[260px] max-w-none px-3 py-2 text-sm focus:outline-none"
      />
    </div>
  );
}
