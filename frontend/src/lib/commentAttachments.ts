import { api } from './apiClient';

export interface CommentAttachment {
  key: string;
  name?: string;
  contentType?: string;
  url?: string | null;
}

/**
 * Upload des images jointes à un commentaire : présignature → PUT direct MinIO.
 * Renvoie les descripteurs (clé/nom/type) à joindre au commentaire.
 */
export async function uploadCommentImages(files: File[]): Promise<CommentAttachment[]> {
  const images = files.filter((f) => /^image\/(png|jpe?g|webp|gif)$/.test(f.type)).slice(0, 8);
  const out: CommentAttachment[] = [];
  for (const file of images) {
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
