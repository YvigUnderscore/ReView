import { api } from './apiClient';

export interface CommentAttachment {
  key: string;
  name?: string;
  contentType?: string;
  url?: string | null;
}

/** Types acceptés en pièce jointe (miroir du Zod backend) : images + PDF/zip/texte. */
export const ATTACHMENT_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,.pdf,.zip,.txt';

/** Nombre maximal de pièces jointes par commentaire (miroir du Zod backend). */
export const MAX_COMMENT_ATTACHMENTS = 8;

export function isAllowedAttachment(contentType: string): boolean {
  return /^(image\/(png|jpe?g|webp|gif)|application\/(pdf|zip)|text\/plain)$/.test(contentType);
}

/** Pièce jointe affichable en vignette (les autres = chip fichier téléchargeable). */
export function isImageAttachment(contentType?: string): boolean {
  return !!contentType && contentType.startsWith('image/');
}

/**
 * Upload des pièces jointes d'un commentaire : présignature → PUT direct MinIO.
 * Renvoie les descripteurs (clé/nom/type) à joindre au commentaire.
 */
export async function uploadCommentAttachments(files: File[]): Promise<CommentAttachment[]> {
  const allowed = files.filter((f) => isAllowedAttachment(f.type)).slice(0, MAX_COMMENT_ATTACHMENTS);
  const out: CommentAttachment[] = [];
  for (const file of allowed) {
    const { url, key } = await api.post<{ url: string; key: string }>('/api/comments/attachments/presign', {
      filename: file.name,
      contentType: file.type,
    });
    const put = await fetch(url, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
    if (!put.ok) throw new Error(`Échec de l’upload de ${file.name}`);
    out.push({ key, name: file.name, contentType: file.type });
  }
  return out;
}
