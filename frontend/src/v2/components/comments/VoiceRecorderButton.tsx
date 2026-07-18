import { useEffect, useRef, useState } from 'react';
import { Mic, Square } from 'lucide-react';
import { toast } from 'sonner';

/** mm:ss d'une durée en secondes. */
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/**
 * Note vocale (32.F) : enregistre au micro (MediaRecorder, webm/opus) et remet le
 * fichier au composer comme pièce jointe audio — lue inline dans le fil.
 */
export default function VoiceRecorderButton({ onRecorded }: { onRecorded: (file: File) => void }) {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  // Chronomètre d'enregistrement (arrêté avec l'enregistreur).
  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [recording]);

  // Coupe le micro si le composant est démonté en cours d'enregistrement.
  useEffect(
    () => () => {
      recorderRef.current?.stream.getTracks().forEach((tr) => tr.stop());
    },
    [],
  );

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';
      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        stream.getTracks().forEach((tr) => tr.stop());
        const type = rec.mimeType || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type });
        const ext = type.includes('ogg') ? 'ogg' : type.includes('mp4') ? 'm4a' : 'webm';
        const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
        if (blob.size > 0)
          onRecorded(new File([blob], `note-vocale-${stamp}.${ext}`, { type: type.split(';')[0] }));
      };
      recorderRef.current = rec;
      rec.start();
      setElapsed(0);
      setRecording(true);
    } catch {
      toast.error('Micro indisponible (permission refusée ?)');
    }
  };

  const stop = () => {
    recorderRef.current?.stop();
    setRecording(false);
  };

  return (
    <button
      type="button"
      onClick={() => (recording ? stop() : void start())}
      title={recording ? 'Terminer la note vocale' : 'Enregistrer une note vocale'}
      className={`flex items-center gap-1 rounded-md p-1.5 text-xs ${
        recording
          ? 'bg-destructive/15 text-destructive'
          : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
      }`}
    >
      {recording ? (
        <>
          <Square size={14} className="animate-pulse" /> {fmt(elapsed)}
        </>
      ) : (
        <Mic size={16} />
      )}
    </button>
  );
}
