import { motion, AnimatePresence } from 'framer-motion';
import type { ReactNode } from 'react';

/**
 * Dialogue de confirmation modal réutilisable (suppression, purge…).
 * Rendu conditionnel via `open` ; appelle `onConfirm`/`onCancel`.
 */
export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirmer',
  cancelLabel = 'Annuler',
  danger = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onCancel}
        >
          <motion.div
            className="w-full max-w-md rounded-lg border border-border bg-card p-5 shadow-xl"
            initial={{ scale: 0.95, y: 8 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.95, y: 8 }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-2 text-base font-semibold">{title}</h3>
            <div className="mb-5 text-sm text-muted-foreground">{message}</div>
            <div className="flex justify-end gap-2">
              <button
                onClick={onCancel}
                className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-secondary/60"
              >
                {cancelLabel}
              </button>
              <button
                onClick={onConfirm}
                className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                  danger
                    ? 'bg-destructive text-destructive-foreground hover:opacity-90'
                    : 'bg-primary text-primary-foreground hover:opacity-90'
                }`}
              >
                {confirmLabel}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
